<?php
declare(strict_types=1);
if (!in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    require __DIR__ . '/api/certificate.php';
    exit;
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
$id = (string)($_GET['id'] ?? '');
if (!preg_match('/^SV-[A-Z2-9]{12}$/', $id)) { http_response_code(404); $id = ''; }
$home = rtrim((string)getenv('HOME'), '/');
$documentRoot = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
$baseDir = $home ? $home . '/svoi' : ($documentRoot ? dirname($documentRoot) : dirname(__DIR__));
$file = $id ? $baseDir . '/certificate-data/' . $id . '.json' : '';
$record = $file && is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
$active = is_array($record) && !empty($record['active']);
if (!$active && !http_response_code()) http_response_code(410);
if (!$active) http_response_code($record ? 410 : 404);
$name = $active ? htmlspecialchars((string)$record['displayName'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') : '';
$statusLabels = ['search' => 'Ищу работу', 'working' => 'Работаю', 'paused' => 'Поиск на паузе'];
$status = $active ? ($statusLabels[$record['status']] ?? 'Статус не указан') : '';
$date = $active ? date('d.m.Y, H:i', strtotime((string)$record['updatedAt'])) : '';
$counterLabels = ['vacanciesReviewed' => 'вакансий проверено', 'draftsPrepared' => 'откликов подготовлено', 'applicationsConfirmed' => 'отправок отмечено', 'repliesTracked' => 'диалогов сохранено', 'interviewsPrepared' => 'подготовок к интервью', 'workSessions' => 'рабочих действий', 'activityDays' => 'дней со Своим'];
?><!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title><?= $active ? $name . ' — дневник Своего' : 'Ссылка отключена — Свой' ?></title><style>
:root{font-family:'Segoe UI',Arial,sans-serif;color:#182035;background:#f2f4fa}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:30px}.card{width:min(100%,650px);background:#fff;border:1px solid #e5e8f0;border-radius:28px;padding:35px;box-shadow:0 24px 60px #1e2b4910}.brand{display:flex;align-items:center;gap:9px;font-size:22px;font-weight:700}.mark{width:29px;height:29px;border-radius:50%;background:#182035;position:relative}.mark:after{content:'';position:absolute;width:14px;height:7px;border:3px solid #4382ff;border-top:0;border-radius:0 0 12px 12px;left:5px;top:7px}.status{margin-left:auto;color:#38896c;background:#edf8f3;padding:7px 10px;border-radius:20px;font-size:11px}.person{display:flex;align-items:center;gap:15px;margin:38px 0 30px}.avatar{display:grid;place-items:center;width:58px;height:58px;border-radius:17px;background:#edf2ff;color:#3867f5;font-size:25px}.person h1{font-size:28px;letter-spacing:-1px;margin:0 0 6px}.person p,.meta{color:#8b94a8;font-size:12px;margin:0}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:23px 12px}.stat strong{display:block;font-size:31px;letter-spacing:-1px}.stat span{display:block;color:#858fa3;font-size:10px;line-height:1.5;margin-top:4px}.note{border-top:1px solid #e8ebf2;margin-top:30px;padding-top:20px;font-size:11px;color:#8b94a8;line-height:1.7}.meta{margin-top:14px}.footer{text-align:center;font-size:10px;color:#a1a8b6;margin-top:19px;line-height:1.7}.footer a{color:inherit}.empty h1{font-size:32px;letter-spacing:-1px}.empty p{color:#858fa3;line-height:1.8;font-size:14px;margin-top:16px}@media(max-width:520px){body{padding:15px}.card{padding:25px;border-radius:22px}.status{font-size:9px}.person{margin-top:30px}.person h1{font-size:24px}.stats{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main class="card"><?php if ($active): ?><div class="brand"><span class="mark"></span>Свой<span class="status"><?= htmlspecialchars($status, ENT_QUOTES, 'UTF-8') ?></span></div><section class="person"><span class="avatar">⌁</span><div><h1><?= $name ?></h1><p>Дневник использования «Своего» · <?= htmlspecialchars($id, ENT_QUOTES, 'UTF-8') ?></p></div></section><section class="stats" aria-label="Счётчики действий"><?php foreach ($counterLabels as $key => $label): ?><div class="stat"><strong><?= (int)($record['counters'][$key] ?? 0) ?></strong><span><?= $label ?></span></div><?php endforeach; ?></section><p class="note">Это агрегированные действия, внесённые пользователем приложения. Страница не подтверждает квалификацию, опыт или результат найма. Резюме, переписка и названия работодателей здесь не публикуются.</p><p class="meta">Обновлено владельцем: <?= htmlspecialchars($date, ENT_QUOTES, 'UTF-8') ?> UTC</p><?php else: ?><div class="brand"><span class="mark"></span>Свой</div><section class="empty"><h1>Ссылка больше не активна</h1><p>Владелец отключил эту страницу или она никогда не существовала. Публичные данные и история действий здесь не отображаются.</p></section><?php endif; ?></main><footer class="footer">Локальный помощник «Свой» · <a href="/privacy.html" rel="nofollow">Конфиденциальность</a></footer></body></html>
