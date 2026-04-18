import { monacoTypes } from '@remix-ui/editor'

interface TsCompletionInfo {
  entries: {
    name: string
    kind: string
  }[]
}

// [1/4] This class provides TypeScript/JavaScript autocompletion features to the Monaco editor.
export class RemixTSCompletionProvider implements monacoTypes.languages.CompletionItemProvider {
  monaco: any

  constructor(monaco: any) {
    this.monaco = monaco
  }

  // Defines trigger characters for autocompletion (e.g., suggesting object members after typing '.').
  triggerCharacters = ['.', '"', "'", '/', '@']

  // The main function called by the Monaco editor as the user types.
  async provideCompletionItems(model: monacoTypes.editor.ITextModel, position: monacoTypes.Position, context: monacoTypes.languages.CompletionContext): Promise<monacoTypes.languages.CompletionList | undefined> {
    const word = model.getWordUntilPosition(position)
    const range = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn
    }

    try {
      // [4/4] It fetches type information loaded by the editor plugin ('editor.ts') via 'type-fetcher.ts',
      // using Monaco's built-in TypeScript Worker to generate an autocompletion list.
      const worker = await this.monaco.languages.typescript.getTypeScriptWorker()
      const client = await worker(model.uri)
      const completions: TsCompletionInfo = await client.getCompletionsAtPosition(
        model.uri.toString(),
        model.getOffsetAt(position)
      )

      if (!completions || !completions.entries) {
        return { suggestions: []}
      }

      // Converts the suggestion list from the TypeScript Worker into a format that the Monaco editor can understand.
      const suggestions = completions.entries.map(entry => {
        return {
          label: entry.name,
          kind: this.mapTsCompletionKindToMonaco(entry.kind),
          insertText: entry.name,
          range: range
        }
      })

      return { suggestions }
    } catch (error) {
      console.error('[TSCompletionProvider] Error fetching completions:', error)
      return { suggestions: []}
    }
  }

  // Maps TypeScript's 'CompletionItemKind' string to Monaco's numeric Enum value.
  private mapTsCompletionKindToMonaco(kind: string): monacoTypes.languages.CompletionItemKind {
    const { CompletionItemKind } = this.monaco.languages
    switch (kind) {
    case 'method':
    case 'memberFunction':
      return CompletionItemKind.Method
    case 'function':
      return CompletionItemKind.Function
    case 'property':
    case 'memberVariable':
      return CompletionItemKind.Property
    case 'class':
      return CompletionItemKind.Class
    case 'interface':
      return CompletionItemKind.Interface
    case 'keyword':
      return CompletionItemKind.Keyword
    case 'variable':
      return CompletionItemKind.Variable
    case 'constructor':
      return CompletionItemKind.Constructor
    case 'enum':
      return CompletionItemKind.Enum
    case 'module':
      return CompletionItemKind.Module
    default:
      return CompletionItemKind.Text
    }
  }
}