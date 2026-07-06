export interface InitialCameraState {
  pos: [number, number, number];
  zoom: number;
  theta: number;
  phi: number;
}

export type ShareLocationState = {
  pos: [number, number, number];
  zoom: number;
  theta: number;
  phi: number;
};

export type LayerVisibility = {
  biomeLabels: boolean;
  players: boolean;
  spawn: boolean;
  debug: boolean;
  chunkBorders: boolean;
  showTerrainUnderlay: boolean;
  voxelHeightLabels: boolean;
};

export type FlyToRequest = {
  pos: [number, number, number];
  preserveHeight: boolean;
  key: number;
};
