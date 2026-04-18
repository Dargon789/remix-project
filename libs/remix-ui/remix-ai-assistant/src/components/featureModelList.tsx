import React from 'react'

export function FeatureModelList() {

  const features = [
    {
      name: 'File',
      icon: 'far fa-copy',
      action: () => {}
    },
    {
      name: 'Learn',
      icon: 'fas fa-brain',
      action: () => {}
    },
    {
      name: 'Plan a project',
      icon: 'fas fa-list',
      action: () => {}
    },
    {
      name: 'New workspace',
      icon: 'far fa-plus',
      action: () => {}
    },
    {
      name: 'Deploy',
      icon: 'fa-kit fa-dapp',
      action: () => {}
    },
    {
      name: 'Generate dapp',
      icon: 'fas fa-fighter-jet',
      action: () => {}
    }
  ]

  return (
    <ul className="list-unstyled p-3 ">
      {features.map((feature) => (
        <li key={feature.name} className="d-flex flex-row align-items-center mb-3">
          <button
            className="rounded-circle btn btn-sm border-0 d-flex align-items-center text-theme-contrast justify-content-center me-3"
            style={{
              width: '30px',
              height: '30px'
            }}
            onClick={feature.action}
          >
            <i className={feature.icon} style={{ fontSize: '0.7rem' }}></i>
          </button>
          <span>{feature.name}</span>
        </li>
      ))}
    </ul>
  )
}
