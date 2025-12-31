/* eslint-disable @nrwl/nx/enforce-module-boundaries */
import { Plugin } from '@remixproject/engine'
import { LibraryProfile, MethodApi, StatusEvents } from '@remixproject/plugin-utils'
import { AppModal } from '@remix-ui/app'
import { AlertModal } from '@remix-ui/app'
import { dispatchModalInterface } from '@remix-ui/app'
import { Toaster, toast } from '@remix-ui/toaster'

interface INotificationApi {
  events: StatusEvents
  methods: {
    modal: (args: AppModal) => void
    alert: (args: AlertModal) => void
    toast: (message: string) => number
    hideToaster: (id: number) => void
  }
}

const profile: LibraryProfile<INotificationApi> = {
  name: 'notification',
  displayName: 'Notification',
  description: 'Displays notifications',
  methods: ['modal', 'alert', 'toast', 'hideToaster']
}

export class NotificationPlugin extends Plugin implements MethodApi<INotificationApi> {
  dispatcher: dispatchModalInterface
  toastId: number
  constructor() {
    super(profile)
    this.toastId = 0
  }

  setDispatcher(dispatcher: dispatchModalInterface) {
    this.dispatcher = dispatcher
  }

  async modal(args: AppModal) {
    return this.dispatcher.modal(args)
  }

  async alert(args: AlertModal) {
    return this.dispatcher.alert(args)
  }

  async toast(message: string | JSX.Element, timeout?: number, timestamp?: number): Promise<number> {
    timestamp = timestamp || Date.now()
    timestamp = timestamp + ++this.toastId
    this.dispatcher.toast(message, timeout, timestamp)
    return timestamp
  }

  async hideToaster(id: number) {
    toast.dismiss('toast-' + id)
  }
}
