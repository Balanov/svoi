<?php
declare(strict_types=1);

const MAX_BODY = 2400;
const COUNTERS = ['vacanciesReviewed', 'draftsPrepared', 'applicationsConfirmed', 'repliesTracked', 'interviewsPrepared', 'workSessions', 'activityDays'];
const STATUSES = ['search', 'working', 'paused'];
$home = rtrim((string)getenv('HOME'), '/');
$documentRoot = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
$baseDir = $home ? $home . '/svoi' : ($documentRoot ? dirname($documentRoot) : dirname(__DIR__, 2));
$DATA_DIR = $baseDir . '/certificate-data';
$ORIGIN = 'https://svoi.balanov.pro';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Max-Age: 600');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function respond(int $status, array $body): never {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function validId(string $id): bool { return (bool)preg_match('/^SV-[A-Z2-9]{12}$/', $id); }
function certificatePath(string $dir, string $id): string {
    if (!validId($id)) respond(400, ['error' => 'Некорректный идентификатор']);
    return $dir . '/' . $id . '.json';
}
function readPayload(): array {
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > MAX_BODY) respond(413, ['error' => 'Слишком большой запрос']);
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if ($raw === false || strlen($raw) > MAX_BODY) respond(413, ['error' => 'Слишком большой запрос']);
    try { $data = json_decode($raw, true, 16, JSON_THROW_ON_ERROR); }
    catch (Throwable $e) { respond(400, ['error' => 'Нужен корректный JSON']); }
    if (!is_array($data)) respond(400, ['error' => 'Нужен JSON-объект']);
    return $data;
}
function publicPayload(array $input, bool $create): array {
    $allowed = ['version', 'displayName', 'status', 'counters', 'consent'];
    if (array_diff(array_keys($input), $allowed)) respond(422, ['error' => 'Запрос содержит неразрешённые поля']);
    if (($input['version'] ?? null) !== 1 || !in_array($input['status'] ?? '', STATUSES, true)) respond(422, ['error' => 'Некорректная версия или статус']);
    if ($create && ($input['consent'] ?? null) !== true) respond(422, ['error' => 'Нужно явное согласие на публикацию']);
    $name = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', (string)($input['displayName'] ?? '')));
    if (mb_strlen($name) < 1 || mb_strlen($name) > 80) respond(422, ['error' => 'Имя должно содержать от 1 до 80 символов']);
    $counters = [];
    foreach (COUNTERS as $key) {
        $value = $input['counters'][$key] ?? null;
        if (!is_int($value) && !(is_float($value) && floor($value) === $value)) respond(422, ['error' => 'Счётчики должны быть целыми числами']);
        if ($value < 0 || $value > 1000000000) respond(422, ['error' => 'Некорректное значение счётчика']);
        $counters[$key] = (int)$value;
    }
    return ['version' => 1, 'active' => true, 'displayName' => $name, 'status' => $input['status'], 'counters' => $counters];
}
function secret(): string {
    $header = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if ($header === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strcasecmp((string)$name, 'Authorization') === 0) { $header = (string)$value; break; }
        }
    }
    if (!preg_match('/^Bearer ([A-Za-z0-9_\-\.]{32,128})$/', $header, $matches)) respond(401, ['error' => 'Нужен ключ владельца ссылки']);
    return $matches[1];
}
function rateLimit(string $dir, string $scope, int $limit): void {
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $file = $dir . '/rate-' . hash('sha256', $scope . '|' . $ip . '|' . gmdate('YmdH'));
    $handle = fopen($file, 'c+');
    if (!$handle) respond(503, ['error' => 'Временно недоступно']);
    try {
        if (!flock($handle, LOCK_EX)) respond(503, ['error' => 'Временно недоступно']);
        $raw = stream_get_contents($handle);
        $count = $raw ? (int)$raw : 0;
        if ($count >= $limit) respond(429, ['error' => 'Слишком много запросов. Попробуйте позже.']);
        ftruncate($handle, 0); rewind($handle); fwrite($handle, (string)($count + 1)); fflush($handle);
    } finally { flock($handle, LOCK_UN); fclose($handle); }
}

if (!is_dir($DATA_DIR) && !mkdir($DATA_DIR, 0700, true) && !is_dir($DATA_DIR)) respond(503, ['error' => 'Хранилище недоступно']);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'POST') {
    rateLimit($DATA_DIR, 'create', 8);
    $payload = publicPayload(readPayload(), true);
    $id = '';
    for ($attempt = 0; $attempt < 5; $attempt++) {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $id = 'SV-';
        $bytes = random_bytes(12);
        for ($i = 0; $i < 12; $i++) $id .= $alphabet[ord($bytes[$i]) % strlen($alphabet)];
        if (!file_exists(certificatePath($DATA_DIR, $id))) break;
    }
    $file = certificatePath($DATA_DIR, $id);
    $handle = fopen($file, 'x');
    if (!$handle) respond(503, ['error' => 'Не удалось создать уникальную ссылку']);
    $secret = rtrim(strtr(base64_encode(random_bytes(36)), '+/', '-_'), '=');
    $now = gmdate('c');
    $record = $payload + ['id' => $id, 'secretHash' => password_hash($secret, PASSWORD_DEFAULT), 'startedAt' => $now, 'updatedAt' => $now];
    try {
        if (!flock($handle, LOCK_EX) || fwrite($handle, json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) === false) respond(503, ['error' => 'Не удалось сохранить ссылку']);
        fflush($handle);
    } finally { flock($handle, LOCK_UN); fclose($handle); }
    chmod($file, 0600);
    respond(201, ['id' => $id, 'secret' => $secret, 'publicUrl' => $ORIGIN . '/operator.php?id=' . rawurlencode($id), 'createdAt' => $now]);
}

$id = (string)($_GET['id'] ?? '');
$file = certificatePath($DATA_DIR, $id);
if (!is_file($file)) respond(404, ['error' => 'Страница не найдена']);
rateLimit($DATA_DIR, 'change', 120);
$handle = fopen($file, 'c+');
if (!$handle || !flock($handle, LOCK_EX)) respond(503, ['error' => 'Временно недоступно']);
try {
    $raw = stream_get_contents($handle);
    $record = json_decode($raw ?: '', true);
    if (!is_array($record)) respond(410, ['error' => 'Страница отключена']);
    if (empty($record['active']) || empty($record['secretHash']) || !password_verify(secret(), $record['secretHash'])) respond(403, ['error' => 'Доступ запрещён']);
    if ($method === 'PUT') {
        $payload = publicPayload(readPayload(), false);
        $updated = array_merge($record, $payload, ['updatedAt' => gmdate('c')]);
        $json = json_encode($updated, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        ftruncate($handle, 0); rewind($handle); fwrite($handle, $json); fflush($handle);
        respond(200, ['id' => $id, 'updatedAt' => $updated['updatedAt'], 'active' => true]);
    }
    if ($method === 'DELETE') {
        $action = readPayload()['action'] ?? '';
        if ($action === 'purge') {
            $temp = $file . '.deleting';
            ftruncate($handle, 0); fflush($handle); fclose($handle);
            if (!rename($file, $temp) || !unlink($temp)) respond(500, ['error' => 'Не удалось удалить историю']);
            respond(200, ['deleted' => true]);
        }
        if ($action !== 'revoke') respond(422, ['error' => 'Неизвестное действие']);
        $tombstone = ['version' => 1, 'id' => $id, 'active' => false, 'revokedAt' => gmdate('c')];
        ftruncate($handle, 0); rewind($handle); fwrite($handle, json_encode($tombstone)); fflush($handle);
        respond(200, ['revoked' => true]);
    }
    respond(405, ['error' => 'Метод не поддерживается']);
} finally { if (is_resource($handle)) { flock($handle, LOCK_UN); fclose($handle); } }
