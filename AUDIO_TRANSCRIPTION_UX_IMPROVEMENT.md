# Audio Transcription UX Improvement

## Summary

Modified the audio transcription behavior in the Remix AI Assistant to append transcribed text to the input box instead of immediately executing it as a prompt. This allows users to review and edit the transcription before sending.

## Changes Made

### File Modified
- `libs/remix-ui/remix-ai-assistant/src/components/remix-ui-remix-ai-assistant.tsx`

### Previous Behavior
When audio transcription completed, the transcribed text was immediately sent as a prompt to the AI assistant:

```typescript
onTranscriptionComplete: async (text) => {
  if (sendPromptRef.current) {
    await sendPromptRef.current(text)
    trackMatomoEvent({ category: 'ai', action: 'SpeechToTextPrompt', name: 'SpeechToTextPrompt', isClick: true })
  }
}
```

### New Behavior
When audio transcription completes, the behavior depends on whether the transcription ends with "stop":

**If transcription ends with "stop":** The text is appended to the input box for review (with "stop" and punctuation removed), but NOT executed
**If transcription does NOT end with "stop":** The text is appended to the input box AND automatically executed

```typescript
onTranscriptionComplete: async (text) => {
  // Check if transcription ends with "stop" (case-insensitive, with optional punctuation)
  const trimmedText = text.trim()
  const endsWithStop = /\bstop\b[\s.,!?;:]*$/i.test(trimmedText)

  if (endsWithStop) {
    // Remove "stop" and punctuation from the end and just append to input box (don't execute)
    const promptText = trimmedText.replace(/\bstop\b[\s.,!?;:]*$/i, '').trim()
    setInput(prev => prev ? `${prev} ${promptText}`.trim() : promptText)
    // Focus the textarea so user can review/edit
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
    trackMatomoEvent({ category: 'ai', action: 'SpeechToTextPrompt', name: 'SpeechToTextPrompt', isClick: true })
  } else {
    // Append transcription to the input box and execute the prompt
    setInput(prev => prev ? `${prev} ${text}`.trim() : text)
    if (trimmedText) {
      await sendPrompt(trimmedText)
      trackMatomoEvent({ category: 'ai', action: 'SpeechToTextPrompt', name: 'SpeechToTextPrompt', isClick: true })
    }
    // Focus the textarea
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }
}
```

### Code Cleanup
Removed unused code that was only needed for the previous immediate execution behavior:

1. **Removed ref declaration:**
   ```typescript
   // Ref to hold the sendPrompt function for audio transcription callback
   const sendPromptRef = useRef<((prompt: string) => Promise<void>) | null>(null)
   ```

2. **Removed useEffect that updated the ref:**
   ```typescript
   // Update ref for audio transcription callback
   useEffect(() => {
     sendPromptRef.current = sendPrompt
   }, [sendPrompt])
   ```

## Benefits

1. **Auto-Execute by Default:** Transcriptions are automatically executed for hands-free operation
2. **Review on Demand:** Users can say "stop" at the end to review and edit before sending
3. **Error Correction:** When using "stop", users can fix speech-to-text mistakes
4. **Better UX:** Users can append multiple transcriptions or combine voice with typing
5. **Flexibility:** With "stop", transcriptions can be modified to add context or clarification
6. **Hands-free Operation:** Default behavior enables completely hands-free prompt execution
7. **Punctuation Support:** "stop" works with punctuation (stop., stop!, etc.)

## User Flow

### Standard Flow (Auto-Execute)
1. User clicks the microphone button to start recording
2. User speaks their prompt (e.g., "Explain how to create an ERC-20 token")
3. User clicks the microphone button again to stop recording
4. **Transcribing status** is shown while processing
5. **Transcribed text appears in the input box** (NEW)
6. **Prompt is automatically executed** (NEW)
7. AI response begins streaming immediately (hands-free execution)

### Review Flow (With "stop")
1. User clicks the microphone button to start recording
2. User speaks their prompt ending with "stop" (e.g., "Explain how to create an ERC-20 token stop")
3. User clicks the microphone button again to stop recording
4. **Transcribing status** is shown while processing
5. **Transcribed text appears in the input box** with "stop" removed (NEW)
6. Input textarea is automatically focused (NEW)
7. User can review, edit, or append to the transcription (NEW)
8. User clicks send button or presses Enter to submit the prompt

## Implementation Details

### "Stop" Detection Logic
The implementation uses a word-boundary regex to detect if the transcription ends with "stop" (with optional punctuation):

```typescript
const endsWithStop = /\bstop\b[\s.,!?;:]*$/i.test(trimmedText)
```

Key features:
- **Case-insensitive:** Matches "stop", "Stop", "STOP", etc.
- **Word boundary:** Only matches "stop" as a complete word, not as part of another word
- **Punctuation support:** Handles common punctuation marks after "stop" (., !, ?, ;, :)
- **Trailing whitespace:** Ignores any spaces after "stop" or punctuation

Examples:
- ✅ "Explain ERC-20 tokens stop" → Does NOT auto-execute (review mode)
- ✅ "Help me debug this stop." → Does NOT auto-execute (punctuation supported)
- ✅ "Create a contract STOP!" → Does NOT auto-execute (case-insensitive + punctuation)
- ✅ "Explain ERC-20 tokens" → Auto-executes (no "stop")
- ✅ "Help me debug this" → Auto-executes (no "stop")
- ❌ "Explain stopping contracts" → Auto-executes (word boundary - "stop" not at end)
- ❌ "Tell me to stop the video" → Auto-executes (word boundary - "stop" not at end)

### Smart Text Appending
The implementation intelligently handles existing input in all cases:
- If input is empty: Sets the transcription as the input
- If input exists: Appends the transcription with a space separator
- Always trims whitespace for clean formatting
- When "stop" is detected: Removes "stop" and punctuation before appending

```typescript
// With "stop" - remove the stop command
const promptText = trimmedText.replace(/\bstop\b[\s.,!?;:]*$/i, '').trim()
setInput(prev => prev ? `${prev} ${promptText}`.trim() : promptText)

// Without "stop" - use full text
setInput(prev => prev ? `${prev} ${text}`.trim() : text)
```

### Auto-focus
After transcription, the textarea is automatically focused in all cases:

```typescript
if (textareaRef.current) {
  textareaRef.current.focus()
}
```

## Testing Recommendations

### Auto-Execute (Default Behavior)
1. Test basic transcription flow - text appears in input box and executes
2. Test transcription without "stop" - should auto-execute immediately
3. Test appending and executing multiple transcriptions
4. Test transcription with existing text in input
5. Test error handling (transcription failures)
6. Verify textarea focus behavior
7. Verify prompt execution starts immediately after transcription

### Review Mode with "stop"
1. Test transcription ending with "stop" - should NOT auto-execute
2. Test case-insensitivity - "stop", "Stop", "STOP" should all work
3. Test punctuation support - "stop.", "stop!", "stop?", etc. should all work
4. Test word boundary - "stopping" or "stop the video" should auto-execute (no stop at end)
5. Test "stop" removal - verify the word "stop" and punctuation are removed
6. Test empty prompt after "stop" removal
7. Verify textarea focus after stop detection

### Edge Cases
1. Test "stop" with trailing spaces - "prompt stop  " should work
2. Test "stop" with punctuation and spaces - "prompt stop . " should work
3. Test "stop" as the only word - should result in empty input
4. Test transcription with "stop" in the middle - "stop and continue" should auto-execute
5. Test multiple spaces before "stop" - "prompt  stop" should work
6. Test various punctuation combinations - "stop...", "stop!!", "stop?!"

## Related Files

- Main component: `libs/remix-ui/remix-ai-assistant/src/components/remix-ui-remix-ai-assistant.tsx`
- Transcription hook: `libs/remix-ui/remix-ai-assistant/src/hooks/useAudioTranscription.tsx`
- Prompt input area: `libs/remix-ui/remix-ai-assistant/src/components/prompt.tsx`
