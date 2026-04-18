import { NightwatchBrowser } from 'nightwatch'
import EventEmitter from 'events'

const findElementsAsync = (browser: NightwatchBrowser, selector: string): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    browser.findElements(selector, (result) => {
      resolve(result.value as any)
    })
  })
}

const getTextAsync = (browser: NightwatchBrowser, elementId: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    browser.getText(elementId, (result) => {
      const text = typeof result === 'string' ? result : result.value
      resolve(text as any)
    })
  })
} 


class WaitForElementContainsText extends EventEmitter {
  command (this: NightwatchBrowser, id: string, value: string, timeout = 10000): NightwatchBrowser {
    let waitId // eslint-disable-line
    let currentValues: string[] = []
    const runid = setInterval(async () => {
      try {
        
        let elements = await findElementsAsync(this.api, id)

        if (!elements) {
          currentValues = []
          return
        }

        if (elements.length === 0) {
          currentValues = []
          return
        }

        // Check all elements that match the selector
        let foundMatch = false
        const textValues: string[] = []

        for (const element of elements) {
          let text = await getTextAsync(this.api, element)
          currentValues.push(text)         
          
          if (typeof text === 'string' && text.indexOf(value) !== -1) {
            foundMatch = true
            break
          }
        }

        currentValues = textValues

        if (foundMatch) {
          clearInterval(runid)
          clearTimeout(waitId)
          this.api.assert.ok(true, `WaitForElementContainsText ${id} contains ${value}`)
          this.emit('complete')
        }
      } catch (err) {
        // Ignore errors and continue polling
        console.error(`Error in waitForElementContainsText for selector ${id}:`, err)
      } 
    }, 200)

    waitId = setTimeout(() => {
      clearInterval(runid)
      const valuesFound = currentValues.length > 0 ? currentValues.join(', ') : 'none'
      this.api.assert.fail(`TimeoutError: An error occurred while running .waitForElementContainsText() command on ${id} after ${timeout} milliseconds. expected: ${value} - got: ${valuesFound}`)
    }, timeout)
    return this
  }
}

module.exports = WaitForElementContainsText
