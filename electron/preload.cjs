const { contextBridge, ipcRenderer } = require('electron');

const invoke = channel => payload => ipcRenderer.invoke(`svoi:${channel}`, payload);
contextBridge.exposeInMainWorld('svoi', {
  isDesktop: true,
  load: () => ipcRenderer.invoke('svoi:load'),
  saveProfile: invoke('save-profile'),
  importDocuments: invoke('import-documents'),
  search: invoke('search'),
  review: invoke('review'),
  draft: invoke('draft'),
  addVacancy: invoke('add-vacancy'),
  updateApplication: invoke('update-application'),
  replyDraft: invoke('reply-draft'),
  interview: invoke('interview'),
  chat: invoke('chat'),
  addTask: invoke('add-task'),
  toggleTask: invoke('toggle-task'),
  enableModel: invoke('enable-model'),
  certificateCreate: invoke('certificate-create'),
  certificateSync: invoke('certificate-sync'),
  certificateRevoke: invoke('certificate-revoke'),
  certificatePurge: invoke('certificate-purge'),
  exportResume: invoke('export-resume'),
  openExternal: invoke('open-external'),
  resetAll: invoke('reset-all'),
  onProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('svoi:progress', listener);
    return () => ipcRenderer.removeListener('svoi:progress', listener);
  },
});
