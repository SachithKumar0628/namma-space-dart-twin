// Minimal typing for the Gaussian splat viewer used by PhotorealScanView.
// The package ships JavaScript only; we use a small supported subset of its API.
declare module '@mkkellogg/gaussian-splats-3d' {
  export class Viewer {
    constructor(options?: any);
    addSplatScene(path: string, options?: any): Promise<void>;
    start(): void;
    stop(): void;
    dispose(): Promise<void>;
    forceRenderNextFrame(): void;
    camera: any;
    controls: any;
  }

  export const SceneFormat: {
    Splat: number;
    KSplat: number;
    Ply: number;
    Spz: number;
  };
}
