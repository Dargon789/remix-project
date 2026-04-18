import { Plugin } from '@remixproject/engine'
import { QueryParams } from '@remix-project/remix-lib'
import { Registry } from '@remix-project/remix-lib'

const profile = {
  name: 'config',
  displayName: 'Config',
  description: 'Config',
  methods: ['getAppParameter', 'setAppParameter', 'getEnv'],
  events: ['configChanged']
}

export class ConfigPlugin extends Plugin {
  constructor () {
    super(profile)
  }

  getAppParameter (name: string) {
    const queryParams = new QueryParams()
    const params = queryParams.get()
    const config = Registry.getInstance().get('config').api
    const param = params[name] || config.get(name) || config.get('settings/' + name)
    if (param === 'true') return true
    if (param === 'false') return false
    return param
  }

  setAppParameter (name: string, value: any) {
    const config = Registry.getInstance().get('config').api
    config.set(name, value)
  }

  async getEnv (key: string): Promise<string | undefined> {
    const env: string = await this.call('fileManager', 'readFile', '.env')
    let value
    env.split('\n').forEach((line: string) => {
      const [envKey, envValue] = line.split('=');
      if (envKey === key) {
        value = envValue;
      }
    })
    return value
  }
}
