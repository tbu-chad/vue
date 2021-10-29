import {
  STORE_UNMOUNT_DELAY,
  lastAction,
  onBuild,
  onStart,
  onStop,
  onSet
} from 'nanostores'
import { setupDevtoolsPlugin } from '@vue/devtools-api'

const layerId = 'nanostores'
const inspectorId = 'nanostores'
const pluginConfig = {
  id: 'io.github.nanostores',
  label: 'Nanostores',
  packageName: '@nanostores/vue',
  homepage: 'https://github.com/nanostores',
  logo: 'https://nanostores.github.io/nanostores/logo.svg',
  enableEarlyProxy: true,
  componentStateTypes: ['Nanostores']
}

let inspectorTree = []

function find(target, text) {
  return target.some(item => item.toLowerCase().includes(text.toLowerCase()))
}

function isAtom(store) {
  return !('setKey' in store)
}

export function devtools(app) {
  setupDevtoolsPlugin({ ...pluginConfig, app }, api => {
    api.addTimelineLayer({
      id: layerId,
      label: 'Nanostores',
      color: 0x1f49e0
    })

    api.addInspector({
      id: inspectorId,
      label: 'Nanostores',
      icon: 'storage',
      treeFilterPlaceholder: 'Search for stores'
    })

    api.on.getInspectorTree(payload => {
      if (payload.app === app && payload.inspectorId === inspectorId) {
        payload.rootNodes = payload.filter
          ? inspectorTree.filter(node => {
              let target = [node.id, node.label]
              if (node.tags && node.tags.length > 0) {
                target.push(node.tags[0].label)
              }
              let found = find(target, payload.filter)
              let children
              if (node.children) {
                children = node.children.some(childNode =>
                  find([childNode.id, childNode.label], payload.filter)
                )
              }
              return found || children
            })
          : inspectorTree
      }
    })

    api.on.inspectComponent(payload => {
      if (payload.app === app) {
        let stores = payload.componentInstance.proxy._nanostores || []
        stores.forEach((store, index) => {
          payload.instanceData.state.push({
            type: pluginConfig.componentStateTypes[0],
            key: index,
            editable: true,
            value: store.get()
          })
        })
      }
    })

    api.on.editComponentState(payload => {
      if (
        payload.app === app &&
        payload.type === pluginConfig.componentStateTypes[0]
      ) {
        let {
          path: [index, key],
          state: { newKey, remove, value }
        } = payload
        let store = payload.componentInstance.proxy._nanostores[index]
        if (isAtom(store)) {
          store.set(value)
        } else {
          if (remove) store.setKey(key, undefined)
          if (newKey) {
            store.setKey(newKey, value)
          } else {
            store.setKey(key, value)
          }
        }
      }
    })
  })
}

function isValidPayload(payload, app, storeName) {
  return (
    payload.app === app &&
    payload.inspectorId === inspectorId &&
    payload.nodeId === storeName
  )
}

function createLogger(app, api, store, storeName) {
  onStart(store, () => {
    api.addTimelineEvent({
      layerId,
      event: {
        time: Date.now(),
        title: storeName,
        subtitle: 'was mounted',
        data: {
          message: `${storeName} was mounted`,
          storeName,
          store
        }
      }
    })
  })
  onStop(store, () => {
    setTimeout(() => {
      api.addTimelineEvent({
        layerId,
        event: {
          time: Date.now(),
          title: storeName,
          subtitle: 'was unmounted',
          data: {
            message: `${storeName} was unmounted`,
            storeName,
            store
          }
        }
      })
    }, STORE_UNMOUNT_DELAY)
  })

  onSet(store, ({ changed, newValue }) => {
    api.sendInspectorState(inspectorId)
    api.notifyComponentUpdate()

    let action = store[lastAction]
    let data = {
      action,
      key: changed,
      newValue,
      oldValue: store.get()
    }
    if (typeof data.action === 'undefined') delete data.action
    if (typeof data.key === 'undefined') delete data.key
    api.addTimelineEvent({
      layerId,
      event: {
        time: Date.now(),
        title: storeName,
        subtitle: 'was changed',
        data
      }
    })
  })

  api.on.getInspectorState(payload => {
    if (isValidPayload(payload, app, storeName)) {
      payload.state = {
        state: {},
        store: {
          listeners: store.lc,
          lastAction: store.lastAction
        }
      }
      if (isAtom(store)) {
        payload.state.state = [
          {
            key: 'value',
            value: store.get(),
            editable: true
          }
        ]
      } else {
        payload.state.state = Object.entries(store.get()).map(
          ([key, value]) => ({
            key,
            value,
            editable: true
          })
        )
      }
    }
  })

  api.on.editInspectorState(payload => {
    if (isValidPayload(payload, app, storeName)) {
      let { path, state } = payload
      if (isAtom(store)) {
        store.set(state.value)
      } else {
        store.setKey(path[0], state.value)
      }
    }
  })
}

function createTemplateLogger(app, api, template, templateName, nameGetter) {
  let inspectorNode = {
    id: templateName,
    label: templateName,
    tags: [
      {
        label: 'Template',
        textColor: 0xffffff,
        backgroundColor: 0x1f49e0
      }
    ],
    children: []
  }
  inspectorTree.push(inspectorNode)

  onBuild(template, ({ store }) => {
    let id = `${templateName}:${store.get().id}`
    let storeName = nameGetter(store, templateName)
    api.addTimelineEvent({
      layerId,
      event: {
        time: Date.now(),
        title: storeName,
        subtitle: `was built by ${templateName}`,
        data: {
          message: `${storeName} was built by ${templateName}`,
          store,
          by: {
            templateName,
            template
          }
        }
      }
    })
    createLogger(app, api, store, storeName)
    inspectorNode.children?.push({ id, label: storeName })
  })

  api.on.getInspectorState(payload => {
    if (isValidPayload(payload, app, templateName)) {
      payload.state = {
        template: {
          plural: template.plural,
          remote: template.remote,
          offline: template.offline
        },
        cache: template.cache
      }
      if (template.filters) {
        payload.state.template.filters = template.filters
      }
    }
  })
}

function createStoreLogger(app, api, store, storeName) {
  inspectorTree.push({
    id: storeName,
    label: storeName
  })
  createLogger(app, api, store, storeName)
}

const defaultNameGetter = (store, templateName) =>
  `${templateName}-${store.get().id}`

export function attachStores(app, stores, opts = {}) {
  setupDevtoolsPlugin({ ...pluginConfig, app }, api => {
    let nameGetter = opts.nameGetter || defaultNameGetter
    Object.entries(stores).forEach(([storeName, store]) => {
      'build' in store
        ? createTemplateLogger(app, api, store, storeName, nameGetter)
        : createStoreLogger(app, api, store, storeName)
    })
  })
}
