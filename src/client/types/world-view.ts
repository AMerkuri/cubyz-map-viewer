export type WorldViewMode = "terrain" | "voxel";

export interface InitialCameraState {
  pos: [number, number, number];
  zoom: number;
  theta: number;
  phi: number;
}

export type ShareLocationState = {
  mode: WorldViewMode;
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
  showTerrain: boolean;
  showVoxelTerrain: boolean;
  voxelHeightLabels: boolean;
};

export type FlyToRequest = {
  pos: [number, number, number];
  key: number;
};
