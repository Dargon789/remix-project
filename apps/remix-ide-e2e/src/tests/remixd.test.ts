'use strict'
import { NightwatchBrowser } from 'nightwatch'
import init from '../helpers/init'
import { join } from 'path'
import { ChildProcess, spawn } from 'child_process'
import { homedir } from 'os'

import kill from 'tree-kill'

let remixd: ChildProcess
const assetsTestContract = `import "./contract.sol";
contract Assets {
    uint[] proposals;
    function add(uint8 _numProposals) public {
        proposals.length = _numProposals;
    }
}
`

const gmbhTestContract = `contract gmbh {
    uint[] proposals;
    function register(uint8 _numProposals) public {
        proposals.length = _numProposals;
    }
}
`
const sources = [
  {
    'localhost/folder1/contract2.sol': { content: 'contract test2 { function get () public returns (uint) { return 11; }}' }
  },
  {
    'localhost/src/gmbh/company.sol': { content: assetsTestContract }
  },
  {
    'localhost/src/gmbh/company.sol': { content: assetsTestContract },
    'localhost/src/gmbh/contract.sol': { content: gmbhTestContract }
  },
  {
    'test_import_node_modules.sol': { content: 'import "openzeppelin-solidity/contracts/math/SafeMath.sol";' }
  },
  {
    'test_import_node_modules_with_github_import.sol': { content: 'import "openzeppelin-solidity/contracts/sample.sol";' }
  },
  {
    'test_static_analysis_with_remixd_and_hardhat.sol': {
      content: `
      import "hardhat/console.sol";
      contract test5 { function get () public returns (uint) { return 8; }}`
    }
  }
]

module.exports = {
  '@disabled': true,
  before: function (browser, done) {
    init(browser, done)
  },
  after: function (browser) {
    browser.perform((done) => {
      console.log('remixd', remixd.pid)
      kill(remixd.pid)
      done()
    })
  },

  '@sources': function () {
    return sources
  },
  'run Remixd tests #group1': function (browser) {
    browser.perform(async (done) => {
      try {
        remixd = await spawnRemixd(join(process.cwd(), '/apps/remix-ide', '/contracts'))
      } catch (err) {
        console.error(err)
      }      
      console.log('working directory', process.cwd())
      connectRemixd(browser, done)
    })
      .perform((done) => {
        runTests(browser, done)
      })
  },
  'Import from node_modules #group2': function (browser) {
    /*
      when a relative import is used (i.e import "openzeppelin-solidity/contracts/math/SafeMath.sol")
      remix try to resolve it against the node_modules and installed_contracts folder.
    */
    browser.perform(async (done) => {
      remixd = await spawnRemixd(join(process.cwd(), '/apps/remix-ide', '/contracts'))
      console.log('working directory', process.cwd())
      connectRemixd(browser, done)
    })
      .addFile('test_import_node_modules.sol', sources[3]['test_import_node_modules.sol'])
      .clickLaunchIcon('solidity')
      .setSolidityCompilerVersion('soljson-v0.5.0+commit.1d4f565a.js')
      .testContracts('test_import_node_modules.sol', sources[3]['test_import_node_modules.sol'], ['SafeMath'])
  },
  'Import from node_modules and reference a github import #group3': function (browser) {
    browser.perform(async (done) => {
      remixd = await spawnRemixd(join(process.cwd(), '/apps/remix-ide', '/contracts'))
      console.log('working directory', process.cwd())
      connectRemixd(browser, done)
    })
      .addFile('test_import_node_modules_with_github_import.sol', sources[4]['test_import_node_modules_with_github_import.sol'])
      .clickLaunchIcon('solidity')
      .setSolidityCompilerVersion('soljson-v0.8.20+commit.a1b79de6.js') // open-zeppelin moved to pragma ^0.8.20
      .testContracts('test_import_node_modules_with_github_import.sol', sources[4]['test_import_node_modules_with_github_import.sol'], ['ERC20', 'test11'])
  },
 
  'Should setup a hardhat project #group4': function (browser: NightwatchBrowser) {
    browser.perform(async (done) => {
      await setupHardhatProject()
      done()
    })
  },

  'Should listen on compilation result from hardhat #group4': function (browser: NightwatchBrowser) {

    browser.perform(async (done) => {
      remixd = await spawnRemixd(join(process.cwd(), '/apps/remix-ide/hardhat-boilerplate'))
      console.log('working directory', process.cwd())
      connectRemixd(browser, done)
    })
      .perform(async (done) => {
        console.log('generating compilation result')
        await compileHardhatProject()
        done()
      })
      .expect.element('*[data-id="terminalJournal"]').text.to.contain('receiving compilation result from Hardhat').before(60000)
    
    let addressRef
    browser.clickLaunchIcon('filePanel')
      .openFile('contracts')
      .openFile('contracts/Token.sol')
      .clickLaunchIcon('udapp')
      .selectAccount('0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c')
      .selectContract('Token')
      .createContract('')
      .clickInstance(0)
      .clickFunction('balanceOf - call', { types: 'address account', values: '0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c' })
      .getAddressAtPosition(0, (address) => {
        addressRef = address
      })
      .perform((done) => {
        browser.verifyCallReturnValue(addressRef, ['0:uint256: 1000000'])
          .perform(() => done())
      })
  },

  'Should load compilation result from hardhat when remixd connects #group4': function (browser: NightwatchBrowser) {
    let addressRef
    browser
      .refresh()
      .perform(async (done) => {
        console.log('working directory', process.cwd())
        connectRemixd(browser, done)
      })
      .expect.element('*[data-id="terminalJournal"]').text.to.contain('receiving compilation result from Hardhat').before(60000)

      browser.clickLaunchIcon('filePanel')
      .openFile('contracts')
      .openFile('contracts/Token.sol')
      .clickLaunchIcon('udapp')
      .selectAccount('0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c')
      .selectContract('Token')
      .createContract('')
      .clickInstance(0)
      .clickFunction('balanceOf - call', { types: 'address account', values: '0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c' })
      .getAddressAtPosition(0, (address) => {
        addressRef = address
      })
      .perform((done) => {
        browser.verifyCallReturnValue(addressRef, ['0:uint256: 1000000'])
          .perform(() => done())
      })
  },

  'Should install foundry #group5': function (browser: NightwatchBrowser) {
    browser.perform(async (done) => {
      await downloadFoundry()
      await installFoundry()
      await initFoundryProject()
      done()
    })
  },

  'Should listen on compilation result from foundry #group5': function (browser: NightwatchBrowser) {

    browser.perform(async (done) => {
      console.log('working directory', homedir() + '/foundry_tmp/hello_foundry')
      remixd = await spawnRemixd(join(homedir(), '/foundry_tmp/hello_foundry'))      
      connectRemixd(browser, done)
    })
      .perform(async (done) => {
        await buildFoundryProject()
        done()
      })
      .expect.element('*[data-id="terminalJournal"]').text.to.contain('receiving compilation result from Foundry').before(60000)

    let contractAaddress
    browser.clickLaunchIcon('filePanel')
      .openFile('src')
      .openFile('src/Counter.sol')
      .clickLaunchIcon('udapp')
      .selectContract('Counter')
      .createContract('')
      .getAddressAtPosition(0, (address) => {
        console.log(contractAaddress)
        contractAaddress = address
      })
      .clickInstance(0)
      .clickFunction('increment - transact (not payable)')
      .perform((done) => {
        browser.testConstantFunction(contractAaddress, 'number - call', null, '0:\nuint256: 1').perform(() => {
          done()
        })
      })
  },

  'Should load compilation result from hardhat when remixd connects #group5': function (browser: NightwatchBrowser) {

    browser.refresh().perform(async (done) => {
      console.log('working directory', homedir() + '/foundry_tmp/hello_foundry')
      connectRemixd(browser, done)
    })
      .expect.element('*[data-id="terminalJournal"]').text.to.contain('receiving compilation result from Foundry').before(60000)

    let contractAaddress
    browser.clickLaunchIcon('filePanel')
      .openFile('src')
      .openFile('src/Counter.sol')
      .clickLaunchIcon('udapp')
      .selectContract('Counter')
      .createContract('')
      .getAddressAtPosition(0, (address) => {
        console.log(contractAaddress)
        contractAaddress = address
      })
      .clickInstance(0)
      .clickFunction('increment - transact (not payable)')
      .perform((done) => {
        browser.testConstantFunction(contractAaddress, 'number - call', null, '0:\nuint256: 1').perform(() => {
          done()
        })
      })
  }  
}

function runTests(browser: NightwatchBrowser, done: any) {
  const browserName = browser.options.desiredCapabilities.browserName
  browser.clickLaunchIcon('filePanel')
    .waitForElementVisible('[data-path="folder1"]')
    .click('[data-path="folder1"]')
    .waitForElementVisible('[data-path="contract1.sol"]')
    .assert.containsText('[data-path="contract1.sol"]', 'contract1.sol')
    .assert.containsText('[data-path="contract2.sol"]', 'contract2.sol')
    .waitForElementVisible('[data-path="folder1/contract1.sol"]')
    .assert.containsText('[data-path="folder1/contract1.sol"]', 'contract1.sol')
    .assert.containsText('[data-path="folder1/contract2.sol"]', 'contract2.sol') // load and test sub folder
    .click('[data-path="folder1/contract2.sol"]')
    .click('[data-path="folder1/contract1.sol"]') // open localhost/folder1/contract1.sol
    .pause(1000)
    .testEditorValue('contract test1 { function get () returns (uint) { return 10; }}') // check the content and replace by another
    .setEditorValue('contract test1Changed { function get () returns (uint) { return 10; }}')
    .testEditorValue('contract test1Changed { function get () returns (uint) { return 10; }}')
    .setEditorValue('contract test1 { function get () returns (uint) { return 10; }}')
    .click('[data-path="folder1/contract_' + browserName + '.sol"]') // rename a file and check
    .pause(1000)
    .renamePath('folder1/contract_' + browserName + '.sol', 'renamed_contract_' + browserName, 'folder1/renamed_contract_' + browserName + '.sol')
    .pause(1000)
    .removeFile('folder1/contract_' + browserName + '_toremove.sol', 'localhost')
    .perform(function (done) {
      testImportFromRemixd(browser, () => { done() })
    })
    .clickLaunchIcon('filePanel')
    .waitForElementVisible('[data-path="folder1"]')
    .waitForElementVisible('[data-path="folder1/contract1.sol"]')
    .waitForElementVisible('[data-path="folder1/renamed_contract_' + browserName + '.sol"]') // check if renamed file is preset
    .waitForElementNotPresent('[data-path="folder1/contract_' + browserName + '.sol"]') // check if renamed (old) file is not present
    .waitForElementNotPresent('[data-path="folder1/contract_' + browserName + '_toremove.sol"]') // check if removed (old) file is not present
    .perform(done())
  // .click('[data-path="folder1/renamed_contract_' + browserName + '.sol"]')
}

function testImportFromRemixd(browser: NightwatchBrowser, callback: VoidFunction) {
  browser
    .waitForElementVisible('[data-path="src"]', 100000)
    .click('[data-path="src"]')
    .waitForElementVisible('[data-path="src/gmbh"]', 100000)
    .click('[data-path="src/gmbh"]')
    .waitForElementVisible('[data-path="src/gmbh/company.sol"]', 100000)
    .click('[data-path="src/gmbh/company.sol"]')
    .pause(1000)
    .verifyContracts(['Assets', 'gmbh'])
    .perform(() => { callback() })
}

async function installRemixd(): Promise<void> {
  console.log('installRemixd')
  const remixd = spawn('yarn install', [], { cwd: process.cwd() + '/dist/libs/remixd', shell: true, detached: true })
  return new Promise((resolve, reject) => {
    remixd.stdout.on('data', function (data) {
      console.log(data.toString())
      if(
        data.toString().includes('success Saved lockfile') 
        || data.toString().includes('success Already up-to-date')
        ) {
        
        resolve()
      }
    })
    remixd.stderr.on('err', function (data) {
      console.log(data.toString())
      reject(data.toString())
    })
  })
}

async function spawnRemixd(path: string): Promise<ChildProcess> {
  console.log('spawnRemixd', path)
  await installRemixd()
  const remixd = spawn('chmod +x dist/libs/remixd/src/bin/remixd.js && dist/libs/remixd/src/bin/remixd.js --remix-ide http://127.0.0.1:8080', [`-s ${path}`], { cwd: process.cwd(), shell: true, detached: true })
  return new Promise((resolve, reject) => {
    remixd.stdout.on('data', function (data) {
      console.log(data.toString())
      if(
        data.toString().includes('is listening') 
        || data.toString().includes('There is already a client running')
        ) {
        
        resolve(remixd)
      }
    })
    remixd.stderr.on('err', function (data) {
      console.log(data.toString())
      reject(data.toString())
    })
  })
}

function connectRemixd(browser: NightwatchBrowser, done: any) {
  const browserName = browser.options.desiredCapabilities.browserName
  if (browserName === 'safari' || browserName === 'internet explorer') {
    console.log('do not run remixd test for ' + browserName + ': sauce labs doesn\'t seems to handle websocket')
    browser.end()
    done()
    return
  }

  browser
    .pause(5000)
    .waitForElementVisible('#icon-panel', 2000)
    .clickLaunchIcon('filePanel')
    .clickLaunchIcon('pluginManager')
    .scrollAndClick('#pluginManager *[data-id="pluginManagerComponentActivateButtonremixd"]')
    .waitForElementVisible('*[data-id="remixdConnect-modal-footer-ok-react"]', 2000)
    .pause(2000)
    .click('*[data-id="remixdConnect-modal-footer-ok-react"]')
    .pause(5000)
    .perform(() => done())
}

async function setupHardhatProject(): Promise<void> {
  console.log(process.cwd())
  try {
      const server = spawn('git clone https://github.com/NomicFoundation/hardhat-boilerplate && cd hardhat-boilerplate && yarn install && yarn add "@typechain/ethers-v5@^10.1.0" && yarn add "@typechain/hardhat@^6.1.2" && yarn add "typechain@^8.1.0" && echo "END"', [], { cwd: process.cwd() + '/apps/remix-ide', shell: true, detached: true })
      return new Promise((resolve, reject) => {
          server.on('exit', function (exitCode) {
            console.log("Child exited with code: " + exitCode);
            console.log('end')
            resolve()
          })
      })
  } catch (e) {
      console.log(e)
  }
}

async function compileHardhatProject(): Promise<void> {
  console.log(process.cwd())
  try {
      const server = spawn('npx hardhat compile', [], { cwd: process.cwd() + '/apps/remix-ide/hardhat-boilerplate', shell: true, detached: true })
      return new Promise((resolve, reject) => {
          server.on('exit', function (exitCode) {
            console.log("Child exited with code: " + exitCode);
            console.log('end')
            resolve()
          })
      })
  } catch (e) {
      console.log(e)
  }
}

async function downloadFoundry(): Promise<void> {
  console.log('downloadFoundry', process.cwd())
  try {
      const server = spawn('curl -L https://foundry.paradigm.xyz | bash', [], { cwd: process.cwd(), shell: true, detached: true })
      return new Promise((resolve, reject) => {
          server.stdout.on('data', function (data) {
              console.log(data.toString())
              if (
                  data.toString().includes("simply run 'foundryup' to install Foundry")
                  || data.toString().includes("foundryup: could not detect shell, manually add")
              ) {
                  console.log('resolving')
                  resolve()
              }
          })
          server.stderr.on('err', function (data) {
              console.log(data.toString())
              reject(data.toString())
          })
      })
  } catch (e) {
      console.log(e)
  }
}

async function installFoundry(): Promise<void> {
  console.log('installFoundry', process.cwd())
  try {
      const server = spawn('export PATH="' + homedir() + '/.foundry/bin:$PATH" && foundryup', [], { cwd: process.cwd(), shell: true, detached: true })
      return new Promise((resolve, reject) => {
          server.stdout.on('data', function (data) {
              console.log(data.toString())
              if (
                  data.toString().includes("foundryup: done!")
              ) {
                  console.log('resolving')
                  resolve()
              }
          })
          server.stderr.on('err', function (data) {
              console.log(data.toString())
              reject(data.toString())
          })
      })
  } catch (e) {
      console.log(e)
  }
}

async function initFoundryProject(): Promise<void> {
  console.log('initFoundryProject', homedir())
  try {    
      spawn('git config --global user.email \"you@example.com\"', [], { cwd: homedir(), shell: true, detached: true })
      spawn('git config --global user.name \"Your Name\"', [], { cwd: homedir(), shell: true, detached: true })
      spawn('mkdir foundry_tmp', [], { cwd: homedir(), shell: true, detached: true })
      const server = spawn('export PATH="' + homedir() + '/.foundry/bin:$PATH" && forge init hello_foundry', [], { cwd: homedir() + '/foundry_tmp', shell: true, detached: true })
      server.stdout.pipe(process.stdout)
      return new Promise((resolve, reject) => {
          server.on('exit', function (exitCode) {
            console.log("Child exited with code: " + exitCode);
            console.log('end')
            resolve()
          })
      })
  } catch (e) {
      console.log(e)
  }
}

async function buildFoundryProject(): Promise<void> {
  console.log('buildFoundryProject', homedir())
  try {
      const server = spawn('export PATH="' + homedir() + '/.foundry/bin:$PATH" && forge build', [], { cwd: homedir() + '/foundry_tmp/hello_foundry', shell: true, detached: true })
      server.stdout.pipe(process.stdout)
      return new Promise((resolve, reject) => {
          server.on('exit', function (exitCode) {
            console.log("Child exited with code: " + exitCode);
            console.log('end')
            resolve()
          })
      })
  } catch (e) {
      console.log(e)
  }
}
