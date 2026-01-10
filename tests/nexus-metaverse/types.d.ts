/**
 * Type definitions for the Nexus Metaverse API
 * These types match the NexusAPI class exposed on window.nexusAPI
 */

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface Rotation {
  x: number;
  y: number;
  z: number;
}

export interface CameraState {
  position: Position;
  rotation: Rotation;
}

export interface ActivityLogEntry {
  time: string;
  message: string;
  type: 'action' | 'thought' | 'output';
}

export interface Entity {
  id: string;
  name: string;
  type: 'human' | 'ai' | 'twin';
  state: 'idle' | 'working' | 'thinking' | 'controlled';
  position: Position;
  currentTask: string | null;
  isControlled: boolean;
  controlledBy: string | null;
  isObserved?: boolean;
  activityLog?: ActivityLogEntry[];
}

export interface ChatMessage {
  sender: string;
  text: string;
  isAI: boolean;
  isHuman: boolean;
}

export interface StateSnapshot {
  ready: boolean;
  loading: boolean;
  mode: 'explore' | 'observe' | 'build';
  controlMode: 'observe' | 'guide' | 'takeover';
  isPossessing: boolean;
  camera: CameraState;
  localPlayer: Entity | null;
  observedEntity: Entity | null;
  entityCount: number;
  worldObjectCount: number;
  observationPanelVisible: boolean;
  builderPanelVisible: boolean;
  possessionHUDVisible: boolean;
}

export type Direction = 'forward' | 'backward' | 'left' | 'right' | 'w' | 'a' | 's' | 'd';

export type ControlMode = 'observe' | 'guide' | 'takeover';

export type EntityType = 'human' | 'ai' | 'twin';

export type WorldObjectType = 'cube' | 'sphere' | 'cylinder' | 'tree' | 'light' | 'portal';

export type AppMode = 'explore' | 'observe' | 'build';

/**
 * The NexusAPI interface
 * Available at window.nexusAPI after the metaverse loads
 */
export interface NexusAPI {
  // State Queries
  isReady(): boolean;
  isLoading(): boolean;
  getEntities(): Entity[];
  getEntity(idOrName: string): Entity | null;
  getLocalPlayer(): Entity | null;
  getObservedEntity(): Entity | null;
  getControlMode(): ControlMode;
  isPossessing(): boolean;
  getCameraState(): CameraState;
  getCurrentMode(): AppMode;
  isObservationPanelVisible(): boolean;
  isBuilderPanelVisible(): boolean;
  isPossessionHUDVisible(): boolean;
  getWorldObjectsCount(): number;
  getChatMessages(): ChatMessage[];

  // Actions
  observeEntity(idOrName: string): boolean;
  setControlMode(mode: ControlMode): boolean;
  takeOver(): boolean;
  releaseControl(): boolean;
  pressKey(key: string, duration?: number): Promise<boolean>;
  move(direction: Direction, duration?: number): Promise<boolean>;
  teleportCamera(x: number, y: number, z: number): boolean;
  setCameraRotation(x: number, y: number): boolean;
  setMode(mode: AppMode): boolean;
  sendChatMessage(message: string): boolean;
  commandAI(entityName: string, command: string): boolean;
  addEntity(name: string, type: EntityType, task?: string): boolean;
  placeObject(type: WorldObjectType, x: number, z: number): boolean;

  // Utilities
  getDistance(pos1: Position, pos2: Position): number;
  waitFor(conditionFn: () => boolean, timeout?: number, interval?: number): Promise<boolean>;
  waitForReady(timeout?: number): Promise<boolean>;

  // Test Helpers
  getStateSnapshot(): StateSnapshot;
  reset(): boolean;
}

// Extend Window interface
declare global {
  interface Window {
    nexusAPI: NexusAPI;
    nexus: any;
  }
}
