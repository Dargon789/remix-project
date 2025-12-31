import { ElectronBasePlugin, ElectronBasePluginClient } from "@remixproject/plugin-electron"
import { Profile } from "@remixproject/plugin-utils"
import { autoUpdater } from "electron-updater"
import { app } from 'electron';
import { isE2E } from "../main";
import { trackEvent } from "../utils/matamo";

const profile = {
  displayName: 'appUpdater',
  name: 'appUpdater',
  description: 'appUpdater',
}

export class AppUpdaterPlugin extends ElectronBasePlugin {
  clients: AppUpdaterPluginClient[] = []
  constructor() {
    super(profile, clientProfile, AppUpdaterPluginClient)
    this.methods = [...super.methods]

    autoUpdater.autoDownload = false
    autoUpdater.disableDifferentialDownload = true

    autoUpdater.on('checking-for-update', () => {
      console.log('Checking for update...');
      this.sendToLog('Checking for update...')
    })
    autoUpdater.on('update-available', (info: any) => {
      console.log('Update available.', info);
      this.sendToLog('Update available.')
      for (const client of this.clients) {
        client.askForUpdate()
      }
    })
    autoUpdater.on('update-not-available', () => {
      console.log('Update not available.');
      this.sendToLog('App is already up to date.')

    })
    autoUpdater.on('error', (err) => {
      console.log('Error in auto-updater. ' + err);
      this.sendToLog('Cannot find updates...')
    })
    autoUpdater.on('download-progress', (progressObj) => {
      let log_message = "Download speed: " + progressObj.bytesPerSecond;
      log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
      log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
      console.log(log_message);
      this.sendToLog(log_message)
    })
    autoUpdater.on('update-downloaded', (info) => {
      console.log('Update downloaded');
      this.sendToLog('Update downloaded')
      this.sendToLog('processing download... please wait...')
      for(const client of this.clients) {
        client.downloadReady()
      }
    })
  }

  async sendToLog(message: string): Promise<void> {
    for (const client of this.clients) {
      client.call('terminal', 'log', {
        type: 'log',
        value: message,
      })
    }
  }

}

const clientProfile: Profile = {
  name: 'appUpdater',
  displayName: 'appUpdater',
  description: 'appUpdater',
  methods: ['checkForUpdates', 'download', 'install'],
}

class AppUpdaterPluginClient extends ElectronBasePluginClient {
  constructor(webContentsId: number, profile: Profile) {
    super(webContentsId, profile)
  }

  async onActivation(): Promise<void> {
    this.onload(async () => {
      this.emit('loaded')
      if(isE2E) return
      await this.checkForUpdates()
    })
  }

  async askForUpdate(): Promise<void> {
    this.emit('askForUpdate')
  }

  async downloadReady(): Promise<void> {
    // we do a wait here to make sure that the download is done, it's a bug in electron-updater
    setTimeout(() => {
      this.emit('downloadReady')
    }
    , 10000)
  }

  async download(): Promise<void> {
    autoUpdater.downloadUpdate()
  }

  async install(): Promise<void> {
    autoUpdater.quitAndInstall()
  }

  async checkForUpdates(): Promise<void> {
    console.log('checkForUpdates')
    
    // Get OS information
    const platform = process.platform
    let osName = 'Unknown OS'
    if (platform === 'darwin') osName = 'macOS'
    else if (platform === 'win32') osName = 'Windows'
    else if (platform === 'linux') osName = 'Linux'
    
    // Send welcome message
    const welcomeMessage = `Welcome to Remix Desktop ${autoUpdater.currentVersion} on ${osName}

This desktop version includes:
• Native Git integration - Access your system's Git directly from Remix
• Native Terminals - Full-featured terminal emulator with native shell access
  Click "New Terminal" in the Terminal menu to open native ${osName} terminals

You can use this output terminal to:
• Execute JavaScript scripts
  - Input a script directly in the command line interface
  - Select a JavaScript file in the file explorer and run \`remix.execute()\` or \`remix.exeCurrent()\` in the command line interface
  - Right-click on a JavaScript file in the file explorer and click \`Run\`
`
    
    this.call('terminal', 'log', {
      type: 'log',
      value: welcomeMessage,
    })
    
    trackEvent('App', 'CheckForUpdate', 'Remix Desktop version: ' + autoUpdater.currentVersion, 1);
    autoUpdater.checkForUpdates()
  }
}

