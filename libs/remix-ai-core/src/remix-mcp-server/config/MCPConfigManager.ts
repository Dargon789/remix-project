/**
 * MCP Configuration Manager
 * Loads and manages .mcp.config.json configuration
 */

import { Plugin } from '@remixproject/engine';
import { MCPConfig, defaultMCPConfig, minimalMCPConfig } from '../types/mcpConfig';

export class MCPConfigManager {
  private config: MCPConfig;
  private plugin: Plugin;
  private configPath: string = 'remix.config.json';

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.config = defaultMCPConfig;
    this.plugin.on('fileManager', 'fileSaved', async (filePath: string) => {
      if (filePath === this.configPath){
        const exists = await this.plugin.call('fileManager', 'exists', this.configPath);

        if (exists) {
          const configContent = await this.plugin.call('fileManager', 'readFile', this.configPath);
          const userConfig = JSON.parse(configContent);
          if (userConfig.mcp) {this.config = userConfig.mcp}
          else {
            this.config = minimalMCPConfig
            this.saveConfig(this.config)
          }
        }
      }
    });
  }

  async loadConfig(): Promise<MCPConfig> {
    try {
      const exists = await this.plugin.call('fileManager', 'exists', this.configPath);

      if (exists) {
        const configContent = await this.plugin.call('fileManager', 'readFile', this.configPath);
        const userConfig = JSON.parse(configContent);
        // Merge with defaults
        if (userConfig?.mcp) { this.config = this.mergeConfig(defaultMCPConfig, userConfig)}
        else {
          this.saveConfig(this.config)
        }
      } else {
        this.config = minimalMCPConfig;
        this.saveConfig(this.config)
      }

      return this.config;
    } catch (error) {
      this.config = defaultMCPConfig;
      return this.config;
    }
  }

  async saveConfig(config: MCPConfig): Promise<void> {
    try {
      const exists = await this.plugin.call('fileManager', 'exists', this.configPath);
      let userConfig = {}
      if (exists) {
        const remixConfig = await this.plugin.call('fileManager', 'readFile', this.configPath);
        userConfig = JSON.parse(remixConfig)
      }

      userConfig['mcp'] = config
      const newConfigContent = JSON.stringify(userConfig, null, 2);
      await this.plugin.call('fileManager', 'writeFile', this.configPath, newConfigContent);
      this.config = config;

    } catch (error) {
      console.error(`[MCPConfigManager] Error saving config: ${error.message}`);
      throw error;
    }
  }

  async createDefaultConfig(): Promise<void> {
    try {

      const exists = await this.plugin.call('fileManager', 'exists', this.configPath);
      if (exists) {
        console.log('[MCPConfigManager] Config file already exists, skipping creation');
        return;
      }

      await this.saveConfig(defaultMCPConfig);
      console.log('[MCPConfigManager] Default config file created');
    } catch (error) {
      console.error(`[MCPConfigManager] Error creating default config: ${error.message}`);
      throw error;
    }
  }

  getConfig(): MCPConfig {
    return this.config;
  }

  getSecurityConfig() {
    return this.config.security;
  }

  getValidationConfig() {
    return this.config.validation;
  }

  getResourceConfig() {
    return this.config.resources;
  }

  updateConfig(partialConfig: Partial<MCPConfig>): void {
    this.config = this.mergeConfig(this.config, partialConfig);
    console.log('[MCPConfigManager] Config updated at runtime');
  }

  isToolAllowed(toolName: string): boolean {
    const { excludeTools } = this.config.security;

    if (excludeTools && excludeTools.includes(toolName)) {
      return false;
    }

    return true;
  }

  isPathAllowed(path: string): boolean {
    const { blockedPaths, allowedPaths } = this.config.security;

    if (blockedPaths) {
      for (const blocked of blockedPaths) {
        if (path.includes(blocked)) {
          return false;
        }
      }
    }

    // If allowedPaths is set, only allow paths matching patterns
    if (allowedPaths && allowedPaths.length > 0) {
      let allowed = false;
      for (const allowedPattern of allowedPaths) {
        if (path.includes(allowedPattern) || this.matchPattern(path, allowedPattern)) {
          allowed = true;
          break;
        }
      }
      return allowed;
    }

    // Otherwise, allow by default
    return true;
  }

  private matchPattern(str: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(str);
  }

  private mergeConfig(base: any, override: any): any {
    const result = { ...base };

    for (const key in override) {
      if (override[key] !== undefined) {
        if (typeof override[key] === 'object' && !Array.isArray(override[key]) && override[key] !== null) {
          result[key] = this.mergeConfig(base[key] || {}, override[key]);
        } else {
          result[key] = override[key];
        }
      }
    }

    return result;
  }

  async reloadConfig(): Promise<MCPConfig> {
    return this.loadConfig();
  }

  /**
   * Get configuration summary for logging
   */
  getConfigSummary(): string {
    const config = this.getConfig();
    return JSON.stringify({
      version: config.version,
      security: {
        excludeTools: config.security.excludeTools?.length || 0,
        rateLimitEnabled: config.security.rateLimit?.enabled || false,
        maxRequestsPerMinute: config.security.rateLimit?.requestsPerMinute || config.security.maxRequestsPerMinute
      },
      validation: {
        strictMode: config.validation.strictMode,
        schemasEnabled: config.validation.validateSchemas,
        toolValidationRules: Object.keys(config.validation.toolValidation || {}).length
      },
      resources: {
        cacheEnabled: config.resources?.enableCache || false,
        cacheTTL: config.resources?.cacheTTL || 0
      }
    }, null, 2);
  }

}
