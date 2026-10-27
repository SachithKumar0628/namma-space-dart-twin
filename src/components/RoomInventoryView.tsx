import React, { useState } from 'react';
import { RoomMetadata, DoorwayAnchor } from '../types/dart';
import {
  Compass,
  DoorOpen,
  Plus,
  Trash2,
  Edit2,
  Ruler,
  AlertTriangle,
  CheckCircle2,
  Layers,
  ArrowRight,
  Info,
} from 'lucide-react';

interface RoomInventoryViewProps {
  rooms: RoomMetadata[];
  doorways: DoorwayAnchor[];
  onAddRoom: (room: RoomMetadata) => void;
  onUpdateRoom: (room: RoomMetadata) => void;
  onDeleteRoom: (roomId: string) => void;
  onAddDoorway: (doorway: DoorwayAnchor) => void;
  onUpdateDoorway: (doorway: DoorwayAnchor) => void;
  onDeleteDoorway: (doorwayId: string) => void;
}

export const RoomInventoryView: React.FC<RoomInventoryViewProps> = ({
  rooms,
  doorways,
  onAddRoom,
  onUpdateRoom,
  onDeleteRoom,
  onAddDoorway,
  onUpdateDoorway,
  onDeleteDoorway,
}) => {
  const [editingRoom, setEditingRoom] = useState<RoomMetadata | null>(null);
  const [isAddRoomOpen, setIsAddRoomOpen] = useState(false);
  const [editingDoorway, setEditingDoorway] = useState<DoorwayAnchor | null>(null);
  const [isAddDoorwayOpen, setIsAddDoorwayOpen] = useState(false);

  // Form states for Room
  const [roomForm, setRoomForm] = useState<Partial<RoomMetadata>>({
    id: '',
    name: '',
    category: 'Laboratory',
    lengthMeters: 5.0,
    widthMeters: 4.0,
    heightMeters: 2.8,
    originDescription: 'SW floor corner',
    coordinateConvention: 'Right-Handed Y-Up (Three.js standard)',
    connectedDoorwayIds: [],
    features: {
      doorsCount: 1,
      windowsCount: 1,
      reflectiveSurfaces: false,
      featurelessWhiteWalls: false,
    },
  });

  // Form states for Doorway
  const [doorwayForm, setDoorwayForm] = useState<Partial<DoorwayAnchor>>({
    id: '',
    name: '',
    connectedRoomIds: ['R01', 'R02'],
    widthMeters: 1.0,
    heightMeters: 2.1,
    wallLocation: 'east',
    offsetMeters: 2.0,
    hasClearLineOfSight: true,
    observations: {
      roomAObserved: true,
      roomBObserved: true,
      hasContinuousPassCPhoto: true,
      measuredWidthDiffMm: 2.0,
    },
  });

  const openAddRoom = () => {
    const nextId = `R0${rooms.length + 1}`;
    setRoomForm({
      id: nextId,
      name: `Room ${nextId}`,
      category: 'Office',
      lengthMeters: 5.0,
      widthMeters: 4.0,
      heightMeters: 2.85,
      originDescription: 'South-West floor corner datum',
      coordinateConvention: 'Right-Handed Y-Up (Three.js standard)',
      connectedDoorwayIds: [],
      features: {
        doorsCount: 1,
        windowsCount: 1,
        reflectiveSurfaces: false,
        featurelessWhiteWalls: false,
      },
    });
    setIsAddRoomOpen(true);
  };

  const openEditRoom = (room: RoomMetadata) => {
    setEditingRoom(room);
    setRoomForm({ ...room });
    setIsAddRoomOpen(true);
  };

  const handleSaveRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomForm.id || !roomForm.name) return;

    const savedRoom: RoomMetadata = {
      id: roomForm.id.trim(),
      name: roomForm.name.trim(),
      category: roomForm.category as any,
      lengthMeters: Number(roomForm.lengthMeters) || 0,
      widthMeters: Number(roomForm.widthMeters) || 0,
      heightMeters: Number(roomForm.heightMeters) || 0,
      originDescription: roomForm.originDescription || '',
      coordinateConvention: roomForm.coordinateConvention as any,
      connectedDoorwayIds: roomForm.connectedDoorwayIds || [],
      features: roomForm.features || {
        doorsCount: 1,
        windowsCount: 1,
        reflectiveSurfaces: false,
        featurelessWhiteWalls: false,
      },
      reconstructionDimensionEstimate: editingRoom?.reconstructionDimensionEstimate,
    };

    if (editingRoom) {
      onUpdateRoom(savedRoom);
    } else {
      onAddRoom(savedRoom);
    }

    setIsAddRoomOpen(false);
    setEditingRoom(null);
  };

  const openAddDoorway = () => {
    const nextId = `D0${doorways.length + 1}`;
    setDoorwayForm({
      id: nextId,
      name: `Inter-Room Portal ${nextId}`,
      connectedRoomIds: [rooms[0]?.id || 'R01', rooms[1]?.id || 'R02'],
      widthMeters: 1.05,
      heightMeters: 2.15,
      wallLocation: 'east',
      offsetMeters: 2.0,
      hasClearLineOfSight: true,
      observations: {
        roomAObserved: true,
        roomBObserved: true,
        hasContinuousPassCPhoto: true,
        measuredWidthDiffMm: 2.5,
      },
    });
    setIsAddDoorwayOpen(true);
  };

  const openEditDoorway = (d: DoorwayAnchor) => {
    setEditingDoorway(d);
    setDoorwayForm({ ...d });
    setIsAddDoorwayOpen(true);
  };

  const handleSaveDoorway = (e: React.FormEvent) => {
    e.preventDefault();
    if (!doorwayForm.id || !doorwayForm.name) return;

    const savedDoor: DoorwayAnchor = {
      id: doorwayForm.id.trim(),
      name: doorwayForm.name.trim(),
      connectedRoomIds: doorwayForm.connectedRoomIds as [string, string],
      widthMeters: Number(doorwayForm.widthMeters) || 0,
      heightMeters: Number(doorwayForm.heightMeters) || 0,
      wallLocation: doorwayForm.wallLocation as any,
      offsetMeters: Number(doorwayForm.offsetMeters) || 0,
      hasClearLineOfSight: doorwayForm.hasClearLineOfSight ?? true,
      observations: doorwayForm.observations || {
        roomAObserved: true,
        roomBObserved: true,
        hasContinuousPassCPhoto: true,
      },
    };

    if (editingDoorway) {
      onUpdateDoorway(savedDoor);
    } else {
      onAddDoorway(savedDoor);
    }

    setIsAddDoorwayOpen(false);
    setEditingDoorway(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-400">
              Spatial Topology
            </span>
            <span className="text-xs text-slate-600">•</span>
            <span className="text-xs text-slate-400 font-mono">Floor Plan & Metric Geometry</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tracking-tight">
            Room Inventory & Doorway Anchors
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Physical tape measurements, primary coordinate origins, and shared doorway apertures that anchor independent room pointclouds into a coherent unified coordinate system.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={openAddRoom}
            className="flex items-center gap-1.5 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-mono font-bold text-xs uppercase tracking-wider rounded-lg transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Room</span>
          </button>
          <button
            onClick={openAddDoorway}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono text-xs rounded-lg transition"
          >
            <DoorOpen className="w-4 h-4 text-amber-400" />
            <span>Add Door Anchor</span>
          </button>
        </div>
      </div>

      {/* 2D Floor Plan Schematic Preview */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-sm font-mono text-white">
              2D METRIC FLOOR PLAN SCHEMATIC
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Ground Truth Tape Scale • Right-Handed Coordinate Frame
          </span>
        </div>

        {/* SVG Diagram representing connected rooms and doorway */}
        <div className="bg-slate-950/80 rounded-lg p-6 border border-slate-800/80 flex items-center justify-center overflow-x-auto">
          <svg
            viewBox="0 0 760 320"
            className="w-full max-w-3xl h-auto"
            style={{ minWidth: '600px' }}
          >
            {/* Grid Pattern */}
            <defs>
              <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e293b" strokeWidth="0.8" />
              </pattern>
            </defs>
            <rect width="760" height="320" fill="url(#grid)" />

            {/* Room R01 (Robotics Bay): 6.20m x 4.50m */}
            <g transform="translate(60, 40)">
              <rect
                x="0"
                y="0"
                width="310"
                height="225"
                fill="#0f172a"
                stroke="#06b6d4"
                strokeWidth="2.5"
                rx="4"
              />
              {/* Origin Marker at SW Corner (bottom-left) */}
              <circle cx="10" cy="215" r="7" fill="#06b6d4" />
              <circle cx="10" cy="215" r="14" fill="none" stroke="#06b6d4" strokeWidth="1.5" strokeDasharray="3 3" />
              <text x="30" y="218" fill="#38bdf8" fontSize="11" fontFamily="monospace" fontWeight="bold">
                (0,0,0) ORIGIN R01
              </text>

              {/* Room Label & Dimensions */}
              <text x="18" y="32" fill="#e2e8f0" fontSize="14" fontFamily="monospace" fontWeight="bold">
                R01: Robotics Assembly Bay
              </text>
              <text x="18" y="52" fill="#94a3b8" fontSize="11" fontFamily="monospace">
                Dimensions: 6.20m (L) × 4.50m (W) × 2.85m (H)
              </text>
              <text x="18" y="70" fill="#64748b" fontSize="10" fontFamily="monospace">
                Floor Area: 27.9 m² • Volume: 79.5 m³
              </text>

              {/* Windows on North Wall */}
              <rect x="60" y="-4" width="70" height="6" fill="#38bdf8" />
              <rect x="180" y="-4" width="70" height="6" fill="#38bdf8" />
              <text x="75" y="-8" fill="#38bdf8" fontSize="9" fontFamily="monospace">WINDOW 1</text>
              <text x="195" y="-8" fill="#38bdf8" fontSize="9" fontFamily="monospace">WINDOW 2</text>
            </g>

            {/* Room R02 (Operations): 5.40m x 4.20m */}
            <g transform="translate(370, 55)">
              <rect
                x="0"
                y="0"
                width="270"
                height="210"
                fill="#0b1120"
                stroke="#64748b"
                strokeWidth="2.5"
                rx="4"
              />
              {/* Room Label */}
              <text x="18" y="32" fill="#e2e8f0" fontSize="14" fontFamily="monospace" fontWeight="bold">
                R02: Operations & Telemetry
              </text>
              <text x="18" y="52" fill="#94a3b8" fontSize="11" fontFamily="monospace">
                Dimensions: 5.40m (L) × 4.20m (W) × 2.85m (H)
              </text>
              <text x="18" y="70" fill="#64748b" fontSize="10" fontFamily="monospace">
                Floor Area: 22.7 m² • Volume: 64.7 m³
              </text>
            </g>

            {/* Shared Partition Wall & Doorway D01 */}
            <g transform="translate(370, 115)">
              {/* Door Opening Highlight */}
              <rect x="-8" y="0" width="16" height="75" fill="#f59e0b" rx="2" />
              <text x="-40" y="-12" fill="#fbbf24" fontSize="12" fontFamily="monospace" fontWeight="bold">
                DOORWAY ANCHOR D01
              </text>
              <text x="-35" y="42" fill="#fde68a" fontSize="10" fontFamily="monospace">
                1.05m × 2.15m
              </text>
              <text x="-48" y="94" fill="#94a3b8" fontSize="9" fontFamily="monospace">
                Pass C Continuous Transit
              </text>

              {/* Bidirectional Arrow */}
              <line x1="-25" y1="37" x2="25" y2="37" stroke="#ffffff" strokeWidth="2" strokeDasharray="3 3" />
            </g>
          </svg>
        </div>
      </div>

      {/* Room Cards Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm font-mono text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>REGISTERED ROOM SPACES ({rooms.length})</span>
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {rooms.map((room) => {
            const recon = room.reconstructionDimensionEstimate;
            const hasRecon = !!recon;
            const lenDisparity = hasRecon
              ? (Math.abs(recon.lengthMeters - room.lengthMeters) / room.lengthMeters) * 100
              : null;
            const widDisparity = hasRecon
              ? (Math.abs(recon.widthMeters - room.widthMeters) / room.widthMeters) * 100
              : null;
            const avgDisparity = lenDisparity !== null && widDisparity !== null ? (lenDisparity + widDisparity) / 2 : null;

            return (
              <div
                key={room.id}
                className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg hover:border-slate-700 transition"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2.5 py-1 bg-cyan-950 border border-cyan-800 text-cyan-300 rounded font-mono font-bold text-sm">
                      {room.id}
                    </span>
                    <div>
                      <h4 className="font-bold text-white text-base">{room.name}</h4>
                      <span className="text-[11px] font-mono text-slate-400">{room.category}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openEditRoom(room)}
                      className="p-1.5 text-slate-400 hover:text-cyan-400 transition"
                      title="Edit Room Details"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {rooms.length > 1 && (
                      <button
                        onClick={() => onDeleteRoom(room.id)}
                        className="p-1.5 text-slate-400 hover:text-red-400 transition"
                        title="Delete Room"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Ground Truth Physical Dimensions */}
                <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 space-y-2">
                  <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                    Physical Tape Ground Truth (Meters)
                  </span>
                  <div className="grid grid-cols-3 gap-2 text-xs font-mono text-slate-300">
                    <div>
                      <span className="text-slate-500 block text-[9px]">LENGTH</span>
                      <strong className="text-white text-sm">{room.lengthMeters.toFixed(2)}m</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[9px]">WIDTH</span>
                      <strong className="text-white text-sm">{room.widthMeters.toFixed(2)}m</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[9px]">HEIGHT</span>
                      <strong className="text-white text-sm">{room.heightMeters.toFixed(2)}m</strong>
                    </div>
                  </div>
                </div>

                {/* Reconstruction Scale Comparison */}
                <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800/80 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      Reconstruction Scale Validation
                    </span>
                    {avgDisparity !== null && (
                      <span
                        className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          avgDisparity <= 1.5
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : avgDisparity <= 3.5
                            ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                            : 'bg-amber-950 text-amber-400 border border-amber-800'
                        }`}
                      >
                        {avgDisparity.toFixed(1)}% Scale Disparity
                      </span>
                    )}
                  </div>

                  {hasRecon ? (
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-300">
                      <div>
                        <span className="text-slate-500 block text-[9px]">RECON DIMS</span>
                        <span>{recon.lengthMeters.toFixed(2)}m × {recon.widthMeters.toFixed(2)}m</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[9px]">DATA SOURCE</span>
                        <span className="text-cyan-400 truncate block">{recon.source}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 italic">
                      Awaiting COLMAP / Blender mesh scale calibration inspection.
                    </div>
                  )}
                </div>

                {/* Origin Datum & Door Connections */}
                <div className="text-xs space-y-1.5 text-slate-400 pt-2 border-t border-slate-800/80 font-mono">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-slate-500">Origin:</span>
                    <span className="text-slate-300 truncate">{room.originDescription}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-slate-500">Connected Doors:</span>
                    <span className="text-amber-400 font-bold">
                      {room.connectedDoorwayIds.join(', ') || 'None'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Doorways Section */}
      <div className="space-y-4 pt-4 border-t border-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm font-mono text-white flex items-center gap-2">
            <DoorOpen className="w-4 h-4 text-amber-400" />
            <span>DOORWAY ANCHOR APERTURES ({doorways.length})</span>
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {doorways.map((door) => (
            <div
              key={door.id}
              className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3 shadow-lg"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-amber-950 border border-amber-700 text-amber-300 rounded font-mono font-bold text-xs">
                    {door.id}
                  </span>
                  <strong className="text-white text-sm">{door.name}</strong>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEditDoorway(door)}
                    className="p-1 text-slate-400 hover:text-amber-400 transition"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  {doorways.length > 1 && (
                    <button
                      onClick={() => onDeleteDoorway(door.id)}
                      className="p-1 text-slate-400 hover:text-red-400 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs font-mono text-slate-300 bg-slate-950/50 p-2.5 rounded border border-slate-800">
                <div>
                  <span className="text-slate-500 text-[9px] block">WIDTH</span>
                  <span className="text-white font-bold">{door.widthMeters.toFixed(2)}m</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[9px] block">HEIGHT</span>
                  <span className="text-white font-bold">{door.heightMeters.toFixed(2)}m</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[9px] block">SPANS</span>
                  <span className="text-cyan-400 font-bold">{door.connectedRoomIds.join(' ↔ ')}</span>
                </div>
              </div>

              {/* Reciprocal Observations Status */}
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Observed from {door.connectedRoomIds[0]}:</span>
                  {door.observations.roomAObserved ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Confirmed
                    </span>
                  ) : (
                    <span className="text-red-400">Missing</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Reciprocal from {door.connectedRoomIds[1]}:</span>
                  {door.observations.roomBObserved ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Confirmed
                    </span>
                  ) : (
                    <span className="text-red-400">Missing</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Pass C Transit Frames:</span>
                  {door.observations.hasContinuousPassCPhoto ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Verified
                    </span>
                  ) : (
                    <span className="text-amber-400">Incomplete</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add / Edit Room Modal */}
      {isAddRoomOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
              <Compass className="w-5 h-5 text-cyan-400" />
              <span>{editingRoom ? 'Edit Room Metadata' : 'Register New Room'}</span>
            </h3>

            <form onSubmit={handleSaveRoom} className="space-y-4 text-xs font-mono">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Room ID (e.g., R01)</label>
                  <input
                    type="text"
                    required
                    value={roomForm.id}
                    onChange={(e) => setRoomForm({ ...roomForm, id: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Room Name</label>
                  <input
                    type="text"
                    required
                    value={roomForm.name}
                    onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Length (m)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    required
                    value={roomForm.lengthMeters}
                    onChange={(e) => setRoomForm({ ...roomForm, lengthMeters: parseFloat(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Width (m)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    required
                    value={roomForm.widthMeters}
                    onChange={(e) => setRoomForm({ ...roomForm, widthMeters: parseFloat(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Ceiling H (m)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    required
                    value={roomForm.heightMeters}
                    onChange={(e) => setRoomForm({ ...roomForm, heightMeters: parseFloat(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Coordinate Origin Description</label>
                <input
                  type="text"
                  value={roomForm.originDescription}
                  onChange={(e) => setRoomForm({ ...roomForm, originDescription: e.target.value })}
                  placeholder="e.g. SW floor corner at column"
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddRoomOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded"
                >
                  Save Room
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Doorway Modal */}
      {isAddDoorwayOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
              <DoorOpen className="w-5 h-5 text-amber-400" />
              <span>{editingDoorway ? 'Edit Doorway Anchor' : 'Register Doorway Anchor'}</span>
            </h3>

            <form onSubmit={handleSaveDoorway} className="space-y-4 text-xs font-mono">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Doorway ID (e.g., D01)</label>
                  <input
                    type="text"
                    required
                    value={doorwayForm.id}
                    onChange={(e) => setDoorwayForm({ ...doorwayForm, id: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Anchor Name</label>
                  <input
                    type="text"
                    required
                    value={doorwayForm.name}
                    onChange={(e) => setDoorwayForm({ ...doorwayForm, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Connecting Room A</label>
                  <select
                    value={doorwayForm.connectedRoomIds?.[0]}
                    onChange={(e) =>
                      setDoorwayForm({
                        ...doorwayForm,
                        connectedRoomIds: [e.target.value, doorwayForm.connectedRoomIds?.[1] || ''],
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} — {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Connecting Room B</label>
                  <select
                    value={doorwayForm.connectedRoomIds?.[1]}
                    onChange={(e) =>
                      setDoorwayForm({
                        ...doorwayForm,
                        connectedRoomIds: [doorwayForm.connectedRoomIds?.[0] || '', e.target.value],
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} — {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Width (m)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.4"
                    required
                    value={doorwayForm.widthMeters}
                    onChange={(e) => setDoorwayForm({ ...doorwayForm, widthMeters: parseFloat(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Height (m)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1.0"
                    required
                    value={doorwayForm.heightMeters}
                    onChange={(e) => setDoorwayForm({ ...doorwayForm, heightMeters: parseFloat(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddDoorwayOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded"
                >
                  Save Doorway
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
