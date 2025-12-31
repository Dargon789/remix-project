import React from 'react'
import DropdownMenu, { MenuItem } from './DropdownMenu'

const EmptyDropdown: React.FC<any> = () => {
  const items: MenuItem[] = []

  return (
    <DropdownMenu
      items={items}
      disabled={true}
      triggerDataId="empty-dropdown-trigger"
      panelDataId="empty-dropdown-panel"
    />
  )
}

export default EmptyDropdown
