import { NightwatchBrowser } from 'nightwatch'


function openTemplatesExplorer(browser: NightwatchBrowser) {
  browser
    .click('*[data-id="workspacesSelect"]')
    .click('*[data-id="workspacecreate"]')
    .waitForElementPresent('*[data-id="create-remixDefault"]')
}

module.exports = {
  before: function (browser: NightwatchBrowser, done: VoidFunction) {
    browser.hideToolTips()
    done()
  },
  'open default template': function (browser: NightwatchBrowser) {
    browser
      .hideToolTips()
      .waitForElementVisible('*[data-id="remixIdeIconPanel"]', 10000)

      openTemplatesExplorer(browser)

      browser
      .click('*[data-id="create-remixDefault"]')
      .pause(3000)
      .windowHandles(function (result) {
        console.log(result.value)
        browser.hideToolTips().switchWindow(result.value[1])
          .hideToolTips()
          .waitForElementVisible('*[data-id="treeViewLitreeViewItemtests"]')
          .click('*[data-id="treeViewLitreeViewItemtests"]')
          .waitForElementVisible('*[data-id="treeViewLitreeViewItemcontracts"]')
          .click('*[data-id="treeViewLitreeViewItemcontracts"]')
          .waitForElementVisible('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
          .openFile('contracts/1_Storage.sol')
          .waitForElementVisible('*[id="editorView"]', 10000)
          .getEditorValue((content) => {
            browser.assert.ok(content.includes('function retrieve() public view returns (uint256){'))
          })
      })
  },
  'open template explorer and add template to current': function (browser: NightwatchBrowser) {
    openTemplatesExplorer(browser)

    browser
      .waitForElementVisible('*[data-id="add-simpleEip7702"]')
      .scrollAndClick('*[data-id="add-simpleEip7702"]')
      .waitForElementVisible('*[data-id="treeViewDivtreeViewItemcontracts/Example7702.sol"]')
  }
}
