import ReactReconciler, { HostConfig } from 'react-reconciler'
import BABYLON from 'babylonjs'
import { shallowEqual } from 'shallow-equal-object'

import components from './components.json'

export enum ComponentFamilyType {
  Meshes,
  Lights,
  Materials,
  Camera
}

// TODO: see if it's a 'shape' with oneOf() for props/options
export type ComponentDefinition = {
  name: string
  family: string,
  props?: string[],
  args: string[],
  options?: string[]
}

//** BEGIN WINDOW (needed only for compile)
type RequestIdleCallbackHandle = any;
type RequestIdleCallbackOptions = {
  timeout: number;
};
type RequestIdleCallbackDeadline = {
  readonly didTimeout: boolean;
  timeRemaining: (() => number);
};

declare global {
  interface Window {
    requestIdleCallback: ((
      callback: ((deadline: RequestIdleCallbackDeadline) => void),
      opts?: RequestIdleCallbackOptions,
    ) => RequestIdleCallbackHandle);
    cancelIdleCallback: ((handle: RequestIdleCallbackHandle) => void);
  }
}
//** END WINDOW

// string to () => Vector3 mapping for directions
const directions : Map<String, () => BABYLON.Vector3> = new Map<String, () => BABYLON.Vector3>([
  ['up', BABYLON.Vector3.Up],
  ['down', BABYLON.Vector3.Down],
  ['left', BABYLON.Vector3.Left],
  ['right', BABYLON.Vector3.Right],
  ['forward', BABYLON.Vector3.Forward],
  ['backward', BABYLON.Vector3.Backward]
]);

// to not collide with other props.  will add additional meta data type after { family: string, prop2: number }.
const RENDER_PROP_FAMILY_NAME : string = '__react_fiber_metadata';
interface CreatedInstance {
  __react_fiber_metadata: ComponentFamilyType
}

type HostCreatedInstance = CreatedInstance | undefined

type Props = {
  scene: BABYLON.Scene
}

type Container = {
  canvas: HTMLCanvasElement | WebGLRenderingContext | null,
  engine: BABYLON.Engine,
  _rootContainer?: ReactReconciler.FiberRoot
}

// check if tag is known, get family
export const getFamilyFromComponentDefinition = (tag: string, componentDefinition: ComponentDefinition | undefined) : ComponentFamilyType | undefined => {
  if (componentDefinition) {
    // TODO: this should not be a switch statement:
    switch(componentDefinition.family) {
      case "camera":
        return ComponentFamilyType.Camera;
      case "lights":
        return ComponentFamilyType.Lights;
      case "materials":
        return ComponentFamilyType.Materials;
      case "meshes":
        return ComponentFamilyType.Meshes;  
      default:
        console.error(`unknown family (found tag ${tag})`);
        return undefined;  
    }
  }
}

// dynamically get a Babylon object with args & props setup
export const getBabylon = (definition : ComponentDefinition, options : any) => {
  const args = definition.args.map(a => options[a])
  const babylonjsObject = new (BABYLON as any)[definition.name](...args)

  if (definition.props) {
    definition.props.forEach(p => {
      if (typeof options[p] !== 'undefined' && args.indexOf(p) === -1) {
        // TODO: we need to white-list this
        babylonjsObject[p] = options[p]
      }
    })
  }
  return babylonjsObject
}

// TODO: add developer-tools stuff so it looks better in React panel

type HostContext = {
}

type TimeoutHandler = number | undefined
type NoTimeout = undefined

export const hostConfig: HostConfig<string, Props, Container, HostCreatedInstance, {}, {}, {}, HostContext, {}, {}, TimeoutHandler, NoTimeout> = {
  supportsMutation: true,

  now: Date.now,

  // multiple renderers concurrently render using the same context objects. E.g. React DOM and React ART on the
  // same page. DOM is the primary renderer; ART is the secondary renderer.
  // TODO: see if this should be configurable.
  isPrimaryRenderer: true,
  supportsPersistence: false,
  supportsHydration: false, // TODO: see if this will allow ie: improved HMR support.

  // this enables refs
  getPublicInstance: (element: any) => {
    console.log('getting public instance:', element)
    return element
  },

  getRootHostContext: (rootContainerInstance: Container): HostContext => {
    console.log('getting RootHostContext:', rootContainerInstance)
    return {}
  },

  getChildHostContext: (parentHostContext: HostContext, type: string, rootContainerInstance: Container): HostContext => {
    console.log('gettingChildHostContext:', parentHostContext, type, rootContainerInstance)
    return {}
  },

  prepareUpdate (element: any, oldProps: any, newProps: any) {
    console.log('prepareUpdate', element)
    return true
  },

  // type, { scene, ...props }, { canvas, engine, ...other }, ...more
  createInstance: (type : string, props : Props, rootContainerInstance : Container, hostContext : HostContext, internalInstanceHandle : Object) : CreatedInstance | undefined => {
    const definition: ComponentDefinition | undefined = (components as any)[type];

    const family = getFamilyFromComponentDefinition(type, definition)
    if (!family) {
      console.warn('unsupported tag (no "family" found): ', type)
    }

    console.log('creating:', family, type, definition);

    const { scene } = props;
    const { canvas, engine } = rootContainerInstance;

    console.log('from', scene, canvas, engine)

    // console.log(type, { definition, props, scene, canvas, engine })

    // TODO: check props based on pre-computed static code-analysis of babylonjs
    // these could also use other prop-helpers to make the components nicer to work with
    if (family === ComponentFamilyType.Meshes) {
      const { name, x = 0, y = 0, z = 0, position, ...options } = (props as any) // not type-safe - dynamically generate MeshProps
      // does not work for 2 types: Decal and GroundFromHeightMap
      const mesh = (BABYLON.MeshBuilder as any)[`Create${type}`](name, options, scene)
      mesh.position = position || new BABYLON.Vector3(x, y, z)
      mesh[RENDER_PROP_FAMILY_NAME] = family
      return mesh
    }

    if (family === ComponentFamilyType.Camera) {
      const { x = 0, y = 0, z = 0, position, target, ...options } = (props as any)
      options.position = position || new BABYLON.Vector3(x, y, z)
      if (target) {
        if (type === 'FollowCamera') {
          options.lockedTarget = typeof target === 'string' ? scene.getMeshByName(target) : target
        } else {
          if (typeof target === 'string') {
            let mesh = scene.getMeshByName(target)
            if (mesh) {
              options.lockedTarget = mesh
            } else {
              console.warn('lock target not found:', target)
            }
          } else {
            options.lockedTarget = target
          }
        }
      }

      const camera = getBabylon(definition!, { ...options, scene, canvas, engine })
      camera.attachControl(canvas)
      camera[RENDER_PROP_FAMILY_NAME] = family
      return camera
    }

    if (family === ComponentFamilyType.Lights) {
      const { name, direction = BABYLON.Vector3.Up() } = (props as any)

      let dir : BABYLON.Vector3
      if (typeof direction === 'string') {
        const dirKey = direction.toLowerCase();
        if (!directions.has(dirKey)) {
          console.warn(`Cannot find direction ${direction}.  defaulting to "up"`)
          dir = BABYLON.Vector3.Up()
        } else {
          dir = directions.get(dirKey)!();
        }
      } else {
        dir = direction;
      }
      
      // TODO: implement other lights dynamically.  ie: PointLight, etc.
      const light = new BABYLON.HemisphericLight(name as string, dir, scene) as any;
      light[RENDER_PROP_FAMILY_NAME] = family
      return light
    }

    if (family === ComponentFamilyType.Materials) {
      const material = getBabylon(definition!, { ...props, scene, canvas, engine })
      material[RENDER_PROP_FAMILY_NAME] = family
      return material
    }

    console.error(`TODO: ${type} needs to be turned into a BABYLON instantiater in renderer.`)
  },

  shouldDeprioritizeSubtree: (type: string, props: Props) : boolean => {
    return false;
  },

  createTextInstance: (text: string, rootContainerInstance: Container, hostContext: HostContext, internalInstanceHandle: any): any => {
    return undefined;
  },

  scheduleDeferredCallback: window.requestIdleCallback,
  cancelDeferredCallback: window.cancelIdleCallback,
  setTimeout: window.setTimeout,
  clearTimeout: window.clearTimeout,
  noTimeout: undefined,

  prepareForCommit: () => {
    console.log('prepareForCommit')
  },

  resetAfterCommit: () => {
    console.log('resetAfterCommit')
  },

  appendInitialChild: (parent : CreatedInstance, child : CreatedInstance) => {
    console.log('appentInitialChild', parent, child)
    if (parent && child && parent.__react_fiber_metadata === ComponentFamilyType.Meshes && child.__react_fiber_metadata === ComponentFamilyType.Materials) {
      (parent as any).material = child
    }
  },

  appendChild: (parent : CreatedInstance, child : CreatedInstance) : void => {
    console.log('appended', child, ' to', parent);
  },

  canHydrateInstance: (instance: any, type: string, props: Props) : null | CreatedInstance => {
    console.log('canHydrateInstance', instance, type, props)
    return null;
  },

  finalizeInitialChildren: (parentInstance: HostCreatedInstance, type: string, props: Props, rootContainerInstance: Container,  hostContext: HostContext): boolean => {
    console.log('finalizeInitialChildren', parentInstance, type, props, rootContainerInstance,  hostContext)
    return false;
  },

  appendChildToContainer: (container: Container, child: HostCreatedInstance): void => {
    console.log('append child', child, 'to container', container);
  },

  commitUpdate (element: any, updatePayload: any, type: string, oldProps: any, newProps: any) {
    console.log('commitUpdate', element, updatePayload, type, oldProps, newProps)
    const definition: ComponentDefinition | undefined = (components as any)[type];
    const family = getFamilyFromComponentDefinition(type, definition)
    
    // TODO: check props based on pre-computed static code-analysis of babylonjs

    if (family === ComponentFamilyType.Meshes) {
      if (!shallowEqual(oldProps, newProps)) {
        const { x = 0, y = 0, z = 0, ...props } = newProps
        element.position = new BABYLON.Vector3(x, y, z)

        Object.keys(props).forEach(k => {
          element[k] = props[k]
        })
      }
    }
  },

  removeChild (parentInstance : CreatedInstance, child: CreatedInstance) {
    console.log('remove child', parentInstance, child)
  },

  // text-content nodes are not used
  shouldSetTextContent: (type: string, props: any) => {
    console.log('shouldSetTextContent', type, props)
    return false
  }
  //createTextInstance: (text: => {},
  //commitTextUpdate (textInstance, oldText, newText) {}
}

const ReactReconcilerInst = ReactReconciler(hostConfig)

export function render (reactElement: React.ReactNode, element: Container, callback: () => void) {
  // Create a root Container if it doesnt exist
  if (!element._rootContainer) {
    console.log('creatingContainer', element)
    // createContainer(containerInfo: Container, isAsync: boolean, hydrate: boolean): OpaqueRoot;
    element._rootContainer = ReactReconcilerInst.createContainer(element, false, false /* HMR?? */)
    console.log('created container:', element._rootContainer)
  }

  // update the root Container
  console.log('updating rootContainer, reactElement:', reactElement)
  return ReactReconcilerInst.updateContainer(reactElement, element._rootContainer, null, callback)
}

export function unmount (args: any) {
  console.log('UNMOUNT', ...args)
}
