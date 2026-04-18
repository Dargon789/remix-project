# Toaster Plugin Usage Guide

This guide explains how to use the Remix Toaster notification system in your plugin.

## Overview

The toaster system provides a simple way to display temporary notification messages to users. It's accessible through the `notification` plugin API.

## Basic Usage

### Displaying a Toast

To display a simple toast notification:

```typescript
const id = await remix.call('notification' as any, 'toast', 'Your message here')
```

The `toast` method returns a unique ID (timestamp) that can be used to dismiss the toast later.

### Displaying a Toast with Custom Timeout

By default, toasts disappear after 2000ms (2 seconds). You can specify a custom duration:

```typescript
// Show toast for 10 seconds
const id = await remix.call('notification' as any, 'toast', 'This message will stay longer', 10000)
```

**Timeout Behavior:**
- **Default:** 2000ms (2 seconds)
- **> 2000ms:** Displays a loading spinner icon
- **> 5000ms:** Displays both a loading spinner icon and a close button

### Hiding a Toast Manually

You can dismiss a toast before its timeout expires using the ID returned from the `toast` call:

```typescript
const id = await remix.call('notification' as any, 'toast', 'Processing...')

// Do some work...
await doSomeWork()

// Hide the toast when done
await remix.call('notification' as any, 'hideToaster', id)
```

## API Reference

### `toast(message: string | JSX.Element, timeout?: number, timestamp?: number): Promise<number>`

Displays a toast notification.

**Parameters:**
- `message` - The message to display (string or JSX element)
- `timeout` (optional) - Duration in milliseconds before the toast auto-dismisses (default: 2000)
- `timestamp` (optional) - Custom ID for the toast (auto-generated if not provided)

**Returns:** A unique ID (number) that can be used to dismiss the toast

### `hideToaster(id: number): Promise<void>`

Manually dismisses a specific toast notification.

**Parameters:**
- `id` - The toast ID returned by the `toast` method

## Examples

### Example 1: Simple Notification

```typescript
await remix.call('notification' as any, 'toast', 'File saved successfully!')
```

### Example 2: Long-Running Operation

```typescript
// Show a persistent toast with spinner
const id = await remix.call('notification' as any, 'toast', 'Compiling contracts...', 30000)

try {
  await compileContracts()
  // Hide the toast when done
  await remix.call('notification' as any, 'hideToaster', id)
  // Show success message
  await remix.call('notification' as any, 'toast', 'Compilation completed!')
} catch (error) {
  await remix.call('notification' as any, 'hideToaster', id)
  await remix.call('notification' as any, 'toast', 'Compilation failed!')
}
```

### Example 3: Multiple Sequential Toasts

```typescript
const id1 = await remix.call('notification' as any, 'toast', 'Step 1: Initializing...')
await step1()

const id2 = await remix.call('notification' as any, 'toast', 'Step 2: Processing...')
await step2()

const id3 = await remix.call('notification' as any, 'toast', 'Step 3: Finalizing...')
await step3()

await remix.call('notification' as any, 'toast', 'All steps completed!')
```

## Best Practices

1. **Keep messages concise** - Toast notifications should be brief and to the point
2. **Use appropriate timeouts** - Short messages (< 10 words) can use the default timeout, longer messages should have extended timeouts
3. **Clean up long-running toasts** - Always hide toasts for long-running operations once they complete
4. **Provide feedback** - Use toasts to confirm user actions (saves, deletions, etc.)
5. **Don't overuse** - Too many toasts can be overwhelming; use them for important notifications only

## UI Features

- **Position:** Top-right corner of the screen
- **Styling:** Uses Bootstrap alert classes (`alert-info`)
- **Loading indicator:** Automatically shown for toasts with timeout > 2000ms
- **Close button:** Automatically shown for toasts with timeout > 5000ms
- **Auto-dismiss:** Toasts automatically disappear after the specified timeout
- **Manual dismiss:** Toasts can be dismissed early using `hideToaster`

## TypeScript Types

```typescript
interface ToasterProps {
  message: string | JSX.Element
  timeout?: number
  handleHide?: () => void
  timestamp?: number
  id?: string | number
  onToastCreated?: (toastId: string | number) => void
}
```

## Related APIs

The notification plugin also provides other methods for user interaction:

- `modal()` - Display a modal dialog
- `alert()` - Display an alert dialog

For more information, see the notification plugin documentation.
