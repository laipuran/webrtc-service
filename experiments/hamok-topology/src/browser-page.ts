import { createExperimentNode, type ExperimentNode, type WirePacket, type TraceEvent } from './adapter';

declare global {
  interface Window {
    emitPacket: (packet: WirePacket) => Promise<void>;
    emitTrace: (event: TraceEvent) => Promise<void>;
    experiment: {
      init: (peerId: string, roomEpoch: string, initialVoters: string[]) => void;
      node: () => ExperimentNode;
    };
  }
}

let node: ExperimentNode;
window.experiment = {
  init(peerId, roomEpoch, initialVoters) {
    if (node) throw new Error('Only one native node per context');
    node = createExperimentNode({ peerId, roomEpoch, initialVoters,
      send: packet => { void window.emitPacket(packet); },
      onTrace: event => { void window.emitTrace(event); },
    });
  },
  node: () => node,
};
