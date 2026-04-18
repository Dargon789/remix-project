import { Profile } from "@remixproject/plugin-utils";
import { ElectronBasePlugin, ElectronBasePluginClient } from "@remixproject/plugin-electron"
import chokidar from 'chokidar'
import { ElectronBasePluginRemixdClient } from "../lib/remixd"
import fs from 'fs'
import * as utils from '../lib/utils'

import { basename, join } from "path";
import { spawn } from "child_process";
const profile: Profile = {
    name: 'hardhat',
    displayName: 'electron slither',
    description: 'electron slither',
}

export class HardhatPlugin extends ElectronBasePlugin {
    clients: any[]
    constructor() {
        super(profile, clientProfile, HardhatPluginClient)
        this.methods = [...super.methods]
    }
}

const clientProfile: Profile = {
    name: 'hardhat',
    displayName: 'electron hardhat',
    description: 'electron hardhat',
    methods: ['sync', 'compile', 'runCommand']
}


class HardhatPluginClient extends ElectronBasePluginRemixdClient {
    watcher: chokidar.FSWatcher
    warnlog: boolean
    buildPath: string
    cachePath: string
    logTimeout: NodeJS.Timeout
    processingTimeout: NodeJS.Timeout

    async onActivation(): Promise<void> {
        this.on('fs' as any, 'workingDirChanged', async (path: string) => {
            this.currentSharedFolder = path
            this.startListening()
        })
        this.currentSharedFolder = await this.call('fs' as any, 'getWorkingDir')
        if(this.currentSharedFolder) this.startListening()
    }

    startListening() {
      this.buildPath = utils.absolutePath('artifacts/contracts', this.currentSharedFolder)
      this.cachePath = utils.absolutePath('cache', this.currentSharedFolder)
      this.on('fileManager', 'currentFileChanged', async (currentFile: string) => {
          this.emitContract(basename(currentFile))
      })
      this.listenOnHardhatCompilation()
    }

    listenOnHardhatCompilation() {
        try {
          if (this.watcher) this.watcher.close()
          this.watcher = chokidar.watch(this.cachePath, { depth: 0, ignorePermissionErrors: true, ignoreInitial: true })
          this.watcher.on('change', async () => {
              const currentFile = await this.call('fileManager', 'getCurrentFile')
              this.emitContract(basename(currentFile))
          })
          this.watcher.on('add', async () => {
              const currentFile = await this.call('fileManager', 'getCurrentFile')
              this.emitContract(basename(currentFile))
          })
        } catch (e) {
          console.log('listenOnHardhatCompilation', e)
        }
      }
    
    compile() {
      return new Promise((resolve, reject) => {
        const cmd = `npx hardhat compile`
        this.call('terminal', 'log', { type: 'log', value: `running ${cmd}` })
        const options = { cwd: this.currentSharedFolder, shell: true }
        const child = spawn(cmd, options)
        let error = ''
        child.stdout.on('data', (data) => {
            if (data.toString().includes('Error')) {
                this.call('terminal', 'log', { type: 'error', value: `${data.toString()}` })
            } else {
                const msg = `${data.toString()}`
                console.log('\x1b[32m%s\x1b[0m', msg)
                this.call('terminal', 'log', { type: 'log', value: msg })
            }
        })
        child.stderr.on('data', (err) => {
            error += err.toString() + '\n'
            this.call('terminal', 'log', { type: 'error', value: `${err.toString()}` })
        })
        child.on('close', async () => {
            const currentFile = await this.call('fileManager', 'getCurrentFile')
            this.emitContract(basename(currentFile))
            resolve('')
        })
      })
    }

    private async emitContract(file: string) {
      const contractFilePath = join(this.buildPath, file)
      if (!fs.existsSync(contractFilePath)) return     
      const stat = await fs.promises.stat(contractFilePath)
      if (!stat.isDirectory()) return
      const files = await fs.promises.readdir(contractFilePath)
      const compilationResult = {
        input: {},
        output: {
          contracts: {},
          sources: {}
        },
        solcVersion: null,
        target: null
      }
      for (const file of files) {
        if (file.endsWith('.dbg.json')) { // "artifacts/contracts/Greeter.sol/Greeter.dbg.json"
          const stdFile = file.replace('.dbg.json', '.json')
          const contentStd = await fs.promises.readFile(join(contractFilePath, stdFile), { encoding: 'utf-8' })
          const contentDbg = await fs.promises.readFile(join(contractFilePath, file), { encoding: 'utf-8' })
          const jsonDbg = JSON.parse(contentDbg)
          const jsonStd = JSON.parse(contentStd)
          compilationResult.target = jsonStd.sourceName

          const path = join(contractFilePath, jsonDbg.buildInfo)
          const content = await fs.promises.readFile(path, { encoding: 'utf-8' })
          await this.feedContractArtifactFile(content, compilationResult)
        }
        if (compilationResult.target) {
          // we are only interested in the contracts that are in the target of the compilation
          compilationResult.output = {
            ...compilationResult.output,
            contracts: { [compilationResult.target]: compilationResult.output.contracts[compilationResult.target] }
          }
          this.emit('compilationFinished', compilationResult.target, { sources: compilationResult.input }, 'soljson', compilationResult.output, compilationResult.solcVersion)
        }
      }
    }    
      
    async sync() {
      console.log('syncing Hardhet with Remix...')
      const currentFile = await this.call('fileManager', 'getCurrentFile')
      this.emitContract(basename(currentFile))
    }

    runCommand(commandArgs: string) {
      return new Promise((resolve, reject) => {
        // Validate that the command is a Hardhat command
        const commandParts = commandArgs.trim().split(' ')

        // Allow 'npx hardhat' or 'hardhat' commands
        if (commandParts[0] === 'npx' && commandParts[1] !== 'hardhat') {
          reject(new Error('Command must be an npx hardhat command'))
          return
        } else if (commandParts[0] !== 'npx' && commandParts[0] !== 'hardhat') {
          reject(new Error('Command must be a hardhat command (use "npx hardhat" or "hardhat")'))
          return
        }

        const cmd = commandArgs
        this.call('terminal', 'log', { type: 'log', value: `running ${cmd}` })
        const options = { cwd: this.currentSharedFolder, shell: true }
        const child = spawn(cmd, options)
        let stdout = ''
        let stderr = ''

        child.stdout.on('data', (data) => {
          const output = data.toString()
          stdout += output
          this.call('terminal', 'log', { type: 'log', value: output })
        })

        child.stderr.on('data', (err) => {
          const output = err.toString()
          stderr += output
          this.call('terminal', 'log', { type: 'error', value: output })
        })

        child.on('close', (code) => {
          if (code === 0) {
            resolve({ stdout, stderr, exitCode: code })
          } else {
            reject(new Error(`Command failed with exit code ${code}: ${stderr}`))
          }
        })

        child.on('error', (err) => {
          reject(err)
        })
      })
    }

    async feedContractArtifactFile(artifactContent, compilationResultPart) {
      const contentJSON = JSON.parse(artifactContent)
      compilationResultPart.solcVersion = contentJSON.solcVersion
      for (const file in contentJSON.input.sources) {
        const source = contentJSON.input.sources[file]
        const absPath = join(this.currentSharedFolder, file)
        if (fs.existsSync(absPath)) { // if not that is a lib
          const contentOnDisk = await fs.promises.readFile(absPath, { encoding: 'utf-8' })
          if (contentOnDisk === source.content) {
            compilationResultPart.input[file] = source
            compilationResultPart.output['sources'][file] = contentJSON.output.sources[file]
            compilationResultPart.output['contracts'][file] = contentJSON.output.contracts[file]
            if (contentJSON.output.errors && contentJSON.output.errors.length) {
              compilationResultPart.output['errors'] = contentJSON.output.errors.filter(error => error.sourceLocation.file === file)
            }
          }
        }
      }
    }
}