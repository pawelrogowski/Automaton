import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Stage, Layer, Image, Rect, Line } from 'react-konva';
import useImage from 'use-image';
import { v4 as uuidv4 } from 'uuid';
import StyledMinimap, {
  StyledMapControls,
  ControlGroup,
  ControlButton,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ControlsGrid,
  ControlLabel,
  ColorInput,
} from './Minimap.styled.js';
import CustomSwitch from '../CustomSwitch/CustomSwitch.js';
import {
  addWaypoint,
  removeWaypoint,
  setwptId,
  setwptSelection,
  addSpecialArea,
  removeSpecialArea,
} from '../../redux/slices/cavebotSlice.js';
import { MAX_WAYPOINTS_PER_SECTION } from '../../redux/slices/cavebotSlice.js';
import { MINIMAP_COLORS } from './colors.js';

// --- Constants ---
const CANVAS_SIZE = 500;
const MIN_ZOOM = 2;
const MAX_ZOOM = 50;

const SPECIAL_AREA_TYPE_OPTIONS = [
  {
    value: 'cavebot_255',
    label: 'Cavebot (Avoidance 255)',
    type: 'cavebot',
    avoidance: 255,
  },
  {
    value: 'cavebot_20',
    label: 'Cavebot (Avoidance 20)',
    type: 'cavebot',
    avoidance: 20,
  },
  {
    value: 'targeting_255',
    label: 'Targeting (Avoidance 255)',
    type: 'targeting',
    avoidance: 255,
  },
  {
    value: 'targeting_20',
    label: 'Targeting (Avoidance 20)',
    type: 'targeting',
    avoidance: 20,
  },
];

const WAYPOINT_TYPE_OPTIONS = [
  { value: 'Node', label: 'Node' },
  { value: 'Walk', label: 'Walk' },
  { value: 'Stand', label: 'Stand' },
  { value: 'Shovel', label: 'Shovel' },
  { value: 'Rope', label: 'Rope' },
  { value: 'Machete', label: 'Machete' },
  { value: 'Ladder', label: 'Ladder' },
  { value: 'Script', label: 'Script' },
];

// --- Settings Modal Component ---
const MinimapSettingsModal = React.memo(
  ({ isOpen, onClose, settings, onChange }) => {
    useEffect(() => {
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') onClose();
      };
      if (isOpen) {
        window.addEventListener('keydown', handleKeyDown);
      }
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleColorChange = (category, key, value) => {
      onChange((prev) => ({
        ...prev,
        [category]: { ...prev[category], [key]: value },
      }));
    };

    const handleWaypointColorChange = (type, value) => {
      onChange((prev) => ({
        ...prev,
        waypoints: {
          ...prev.waypoints,
          typeColors: { ...prev.waypoints.typeColors, [type]: value },
        },
      }));
    };

    const handleToggle = (category) => {
      onChange((prev) => ({
        ...prev,
        [category]: { ...prev[category], draw: !prev[category].draw },
      }));
    };

    return (
      <ModalOverlay onClick={onClose}>
        <ModalContent onClick={(e) => e.stopPropagation()}>
          <ModalHeader>Minimap Display Settings</ModalHeader>
          <ControlsGrid>
            {/* Player */}
            <ControlLabel>Player</ControlLabel>
            <ColorInput
              value={settings.player.color}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                handleColorChange('player', 'color', e.target.value)
              }
            />
            <CustomSwitch
              checked={settings.player.draw}
              onChange={() => handleToggle('player')}
            />

            {/* Path */}
            <ControlLabel>Path</ControlLabel>
            <ColorInput
              value={settings.path.color}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                handleColorChange('path', 'color', e.target.value)
              }
            />
            <CustomSwitch
              checked={settings.path.draw}
              onChange={() => handleToggle('path')}
            />

            {/* Special Areas */}
            <ControlLabel>Special Areas</ControlLabel>
            <ColorInput
              value={settings.specialAreas.fill}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                handleColorChange('specialAreas', 'fill', e.target.value)
              }
            />
            <CustomSwitch
              checked={settings.specialAreas.draw}
              onChange={() => handleToggle('specialAreas')}
            />

            {/* Entities */}
            <ControlLabel>Entities</ControlLabel>
            <ColorInput
              value={settings.entity.color}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                handleColorChange('entity', 'color', e.target.value)
              }
            />
            <CustomSwitch
              checked={settings.entity.draw}
              onChange={() => handleToggle('entity')}
            />

            {/* Waypoints Header */}
            <ControlLabel>Waypoints</ControlLabel>
            <div />
            <CustomSwitch
              checked={settings.waypoints.draw}
              onChange={() => handleToggle('waypoints')}
            />

            {/* Waypoint Types */}
            {WAYPOINT_TYPE_OPTIONS.map((opt) => (
              <React.Fragment key={opt.value}>
                <ControlLabel isSub>{opt.label}</ControlLabel>
                <ColorInput
                  value={settings.waypoints.typeColors[opt.value]}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    handleWaypointColorChange(opt.value, e.target.value)
                  }
                />
                <div />
              </React.Fragment>
            ))}
          </ControlsGrid>
        </ModalContent>
      </ModalOverlay>
    );
  },
);

// --- Component ---
const Minimap = () => {
  const dispatch = useDispatch();
  const stageRef = useRef(null);
  const minimapContainerRef = useRef(null);
  const contextMenuRef = useRef(null);

  // --- Redux State ---
  const {
    playerPosition,
    currentSection,
    allWaypoints,
    waypointCount, // Ensure waypointCount is destructured here
    wptSelection,
    wptId,
    allPathWaypoints,
    specialAreas,
    creatures,
  } = useSelector((state) => {
    const currentSection = state.cavebot.currentSection;
    const currentWaypoints =
      state.cavebot.waypointSections[currentSection]?.waypoints || [];
    return {
      playerPosition: state.gameState.playerMinimapPosition,
      currentSection,
      allWaypoints: currentWaypoints,
      waypointCount: currentWaypoints.length, // Add waypointCount to state
      wptSelection: state.cavebot.wptSelection,
      wptId: state.cavebot.wptId,
      allPathWaypoints: state.pathfinder.pathWaypoints, // Corrected slice
      specialAreas: state.cavebot.specialAreas,
      creatures: state.targeting.creatures,
    };
  });

  // --- Component State ---
  const [mapMode, setMapMode] = useState('map');
  const [zLevel, setZLevel] = useState(playerPosition.z ?? 7);
  const [mapUrl, setMapUrl] = useState('');
  const [mapIndex, setMapIndex] = useState(null);
  const [stagePos, setStagePos] = useState({ x: 32097, y: 32219 });
  const [stageScale, setStageScale] = useState(10);
  const [tooltip, setTooltip] = useState({
    visible: false,
    x: 0,
    y: 0,
    text: '',
  });
  const [rightClickMenu, setRightClickMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    stage: 0, // 0: main category selection, 1: waypoint actions, 2: special area actions
    selectedCategory: null,
    targetPos: null,
    targetWaypointId: null,
    targetSpecialAreaId: null,
    hoveredItem: null,
  });
  const [isLockedToPlayer, setIsLockedToPlayer] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canvasDimensions, setCanvasDimensions] = useState({
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
  });
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [lastVisibleTimestamp, setLastVisibleTimestamp] = useState(Date.now());
  const [drawSettings, setDrawSettings] = useState(() => {
    const defaultSettings = {
      player: { draw: true, color: MINIMAP_COLORS.PLAYER },
      path: { draw: true, color: MINIMAP_COLORS.PATH },
      waypoints: {
        draw: true,
        typeColors: {
          ...MINIMAP_COLORS.WAYPOINT_TYPE,
          Shovel: '#C0C0C0', // Silver
          Rope: '#8B4513', // SaddleBrown
          Machete: '#2E8B57', // SeaGreen
        },
      },
      specialAreas: {
        draw: true,
        fill: MINIMAP_COLORS.SPECIAL_AREA.fill,
        stroke: MINIMAP_COLORS.SPECIAL_AREA.stroke,
      },
      entity: { draw: true, color: MINIMAP_COLORS.ENTITY },
    };

    try {
      const saved = localStorage.getItem('minimapDrawSettings');
      if (!saved) return defaultSettings;

      const parsed = JSON.parse(saved);

      // Deep merge to ensure compatibility with new versions
      const merged = { ...defaultSettings, ...parsed };
      merged.player = { ...defaultSettings.player, ...parsed.player };
      merged.path = { ...defaultSettings.path, ...parsed.path };
      merged.waypoints = { ...defaultSettings.waypoints, ...parsed.waypoints };
      if (merged.waypoints && parsed.waypoints) {
        merged.waypoints.typeColors = {
          ...defaultSettings.waypoints.typeColors,
          ...parsed.waypoints.typeColors,
        };
      }
      merged.specialAreas = {
        ...defaultSettings.specialAreas,
        ...parsed.specialAreas,
      };
      merged.entity = { ...defaultSettings.entity, ...parsed.entity };
      return merged;
    } catch (e) {
      console.error('Failed to load minimap settings, using defaults.', e);
      return defaultSettings;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('minimapDrawSettings', JSON.stringify(drawSettings));
    } catch (e) {
      console.error('Failed to save minimap settings.', e);
    }
  }, [drawSettings]);

  const [mapImage, mapImageStatus] = useImage(mapUrl);

  // --- Data Loading & Processing ---
  useEffect(() => {
    let isMounted = true;
    setMapUrl('');
    setMapIndex(null);
    import(`../../assets/minimaps/_${mapMode}_debug_z${zLevel}.png`)
      .then((m) => {
        if (isMounted) setMapUrl(m.default);
      })
      .catch(() => isMounted && setMapUrl(''));
    import(`../../assets/minimaps/index_z${zLevel}.json`)
      .then((m) => {
        if (isMounted) setMapIndex(m.default);
      })
      .catch(() => isMounted && setMapIndex(null));
    return () => {
      isMounted = false;
    };
  }, [zLevel, mapMode]);

  const visibleWaypoints = useMemo(
    () => allWaypoints.filter((wp) => wp.z === zLevel),
    [allWaypoints, zLevel],
  );
  const visiblePathPoints = useMemo(
    () =>
      allPathWaypoints
        .filter((p) => p.z === zLevel)
        .flatMap((p) => [p.x + 0.5, p.y + 0.5]),
    [allPathWaypoints, zLevel],
  );
  const playerTile = useMemo(
    () => ({
      x: Math.floor(playerPosition.x),
      y: Math.floor(playerPosition.y),
    }),
    [playerPosition.x, playerPosition.y],
  );
  const visibleSpecialAreas = useMemo(
    () => specialAreas.filter((area) => area.z === zLevel && area.enabled),
    [specialAreas, zLevel],
  );
  const visibleEntities = useMemo(
    () => creatures.filter((e) => e.gameCoords.z === zLevel),
    [creatures, zLevel, lastVisibleTimestamp],
  );

  // --- Centering & Resizing Logic ---
  useEffect(() => {
    if (!isLockedToPlayer || !mapIndex) return;
    if (playerPosition.z !== zLevel) setZLevel(playerPosition.z);
    const centerOfTileX = playerPosition.x + 0.5;
    const centerOfTileY = playerPosition.y + 0.5;
    setStagePos({
      x: -centerOfTileX * stageScale + canvasDimensions.width / 2,
      y: -centerOfTileY * stageScale + canvasDimensions.height / 2,
    });
  }, [
    isLockedToPlayer,
    playerPosition,
    mapIndex,
    stageScale,
    canvasDimensions,
    zLevel,
  ]);

  useEffect(() => {
    const updateSize = () => {
      if (minimapContainerRef.current) {
        setCanvasDimensions({
          width: minimapContainerRef.current.clientWidth,
          height: minimapContainerRef.current.clientHeight,
        });
      }
    };
    updateSize();
    const onFullscreenChange = () => {
      const newFullscreenStatus = !!document.fullscreenElement;
      setIsFullscreen(newFullscreenStatus);
      if (!newFullscreenStatus) setIsLockedToPlayer(true);
      setTimeout(updateSize, 10);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setLastVisibleTimestamp(Date.now());
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // --- UI Event Handlers ---
  const handleZChange = (delta) => {
    setIsLockedToPlayer(false);
    setZLevel((prevZ) => Math.max(0, Math.min(15, prevZ + delta)));
  };
  const handleLockToggle = useCallback(
    () => setIsLockedToPlayer((prev) => !prev),
    [],
  );
  const handleFullscreenToggle = () => {
    if (!minimapContainerRef.current) return;
    if (isFullscreen)
      document.exitFullscreen().catch((err) => console.error(err));
    else
      minimapContainerRef.current
        .requestFullscreen()
        .catch((err) => console.error(err));
  };
  const handleMapModeToggle = () =>
    setMapMode((prevMode) => (prevMode === 'map' ? 'waypoint' : 'map'));

  const handleCloseModal = useCallback(() => {
    setIsSettingsModalOpen(false);
  }, []);

  // --- Konva Event Handlers ---
  const handleWheel = (e) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    const newScale =
      e.evt.deltaY > 0
        ? Math.max(MIN_ZOOM, oldScale / 1.1)
        : Math.min(MAX_ZOOM, oldScale * 1.1);
    setStageScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
    setIsLockedToPlayer(false);
  };
  const handleDragEnd = (e) => {
    setIsLockedToPlayer(false);
    setStagePos(e.target.position());
  };

  const handleContextMenu = (e) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos || !mapIndex) return;

    const worldX = Math.floor((pointerPos.x - stage.x()) / stage.scaleX());
    const worldY = Math.floor((pointerPos.y - stage.y()) / stage.scaleY());
    const targetPos = { x: worldX, y: worldY, z: zLevel };

    const existingWaypoint = visibleWaypoints.find(
      (wp) => wp.x === worldX && wp.y === worldY && wp.z === zLevel,
    );
    const existingSpecialArea = visibleSpecialAreas.find(
      (area) =>
        worldX >= area.x &&
        worldX < area.x + area.sizeX &&
        worldY >= area.y &&
        worldY < area.y + area.sizeY &&
        area.z === zLevel,
    );

    const containerRect = minimapContainerRef.current.getBoundingClientRect();
    let menuX = e.evt.clientX;
    let menuY = e.evt.clientY;

    const menuWidth = 180;
    const menuHeight = 2 * 25 + 10; // Height for the initial menu

    if (menuX + menuWidth > containerRect.right) {
      menuX = containerRect.right - menuWidth;
    }
    if (menuX < containerRect.left) {
      menuX = containerRect.left;
    }
    if (menuY + menuHeight > containerRect.bottom) {
      menuY = containerRect.bottom - menuHeight;
    }
    if (menuY < containerRect.top) {
      menuY = containerRect.top;
    }

    setRightClickMenu({
      visible: true,
      x: menuX,
      y: menuY,
      stage: 0, // Always start at the main category selection
      selectedCategory: null,
      targetPos: targetPos,
      targetWaypointId: existingWaypoint ? existingWaypoint.id : null,
      targetSpecialAreaId: existingSpecialArea ? existingSpecialArea.id : null,
      hoveredItem: null,
    });
  };

  const handleMenuItemHover = (item) =>
    setRightClickMenu((prev) => ({ ...prev, hoveredItem: item }));

  const handleMenuCategorySelect = (category) => {
    setRightClickMenu((prev) => ({
      ...prev,
      stage: category === 'waypoints' ? 1 : 2,
      selectedCategory: category,
      hoveredItem: null,
    }));
  };

  const handleMenuItemClick = (item) => {
    const {
      selectedCategory,
      targetPos,
      targetWaypointId,
      targetSpecialAreaId,
    } = rightClickMenu;

    if (selectedCategory === 'waypoints') {
      if (item === 'RemoveWaypoint' && targetWaypointId) {
        dispatch(removeWaypoint(targetWaypointId));
      } else {
        const selectedOption = WAYPOINT_TYPE_OPTIONS.find(
          (opt) => opt.value === item,
        );
        if (selectedOption && targetPos) {
          dispatch(
            addWaypoint({
              id: uuidv4(),
              type: selectedOption.value,
              ...targetPos,
              range: 1,
              action:
                selectedOption.value === 'Script' ? 'Enter your script' : '',
            }),
          );
        }
      }
    } else if (selectedCategory === 'specialAreas') {
      if (item === 'RemoveSpecialArea' && targetSpecialAreaId) {
        dispatch(removeSpecialArea(targetSpecialAreaId));
      } else {
        const selectedOption = SPECIAL_AREA_TYPE_OPTIONS.find(
          (opt) => opt.value === item,
        );
        if (selectedOption && targetPos) {
          dispatch(
            addSpecialArea({
              id: uuidv4(),
              x: targetPos.x,
              y: targetPos.y,
              z: targetPos.z,
              sizeX: 1,
              sizeY: 1,
              avoidance: selectedOption.avoidance,
              type: selectedOption.type,
              enabled: true,
            }),
          );
        }
      }
    }

    setRightClickMenu({ visible: false, x: 0, y: 0, stage: 0 });
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        rightClickMenu.visible &&
        contextMenuRef.current &&
        !contextMenuRef.current.contains(event.target)
      ) {
        setRightClickMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [rightClickMenu.visible]);

  const handleWaypointClick = (e, waypointId) => {
    if (e.evt.button !== 2) dispatch(setwptSelection(waypointId));
  };
  const handleWaypointDoubleClick = (waypointId) =>
    dispatch(setwptId(waypointId));

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') handleLockToggle();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleLockToggle]);

  return (
    <StyledMinimap ref={minimapContainerRef} tabIndex={0}>
      <div style={{ position: 'relative', width: '100%', height: CANVAS_SIZE }}>
        <StyledMapControls>
          <ControlGroup>
            <ControlButton
              position="top"
              onClick={() => handleZChange(-1)}
              title="Go Up"
            >
              ▲
            </ControlButton>
            <ControlButton
              position="bottom"
              onClick={() => handleZChange(+1)}
              title="Go Down"
            >
              ▼
            </ControlButton>
          </ControlGroup>
          <ControlGroup>
            <ControlButton
              position="single"
              onClick={handleMapModeToggle}
              active={mapMode === 'waypoint'}
              title={
                mapMode === 'map' ? 'Show Walkable Area' : 'Show Map Texture'
              }
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M5 13C5 13 8 13 8 9C8 5 8 5 11 5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </ControlButton>
          </ControlGroup>
          <ControlGroup>
            <ControlButton
              position="single"
              onClick={handleLockToggle}
              active={isLockedToPlayer}
              title="Center on Player (Space)"
            >
              <div
                style={{
                  width: '12px',
                  height: '12px',
                  border: '2px solid currentColor',
                  borderRadius: '50%',
                }}
              ></div>
            </ControlButton>
            <ControlButton
              position="single"
              onClick={handleFullscreenToggle}
              style={{ marginTop: '8px' }}
              title="Toggle Fullscreen"
            >
              <div
                style={{ width: '14px', height: '14px', position: 'relative' }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '4px',
                    height: '4px',
                    borderTop: '2px solid currentColor',
                    borderLeft: '2px solid currentColor',
                  }}
                ></div>
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: '4px',
                    height: '4px',
                    borderTop: '2px solid currentColor',
                    borderRight: '2px solid currentColor',
                  }}
                ></div>
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    width: '4px',
                    height: '4px',
                    borderBottom: '2px solid currentColor',
                    borderLeft: '2px solid currentColor',
                  }}
                ></div>
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: '4px',
                    height: '4px',
                    borderBottom: '2px solid currentColor',
                    borderRight: '2px solid currentColor',
                  }}
                ></div>
              </div>
            </ControlButton>
          </ControlGroup>
          <ControlGroup>
            <ControlButton
              position="single"
              onClick={() => setIsSettingsModalOpen(true)}
              title="Display Settings"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51-1z"></path>
              </svg>
            </ControlButton>
          </ControlGroup>
        </StyledMapControls>
        <div
          style={{
            width: '100%',
            height: '100%',
            cursor: 'grab',
            background: '#222',
            overflow: 'hidden',
            borderRadius: '4px',
          }}
        >
          <Stage
            width={canvasDimensions.width}
            height={canvasDimensions.height}
            onWheel={handleWheel}
            onContextMenu={handleContextMenu}
            ref={stageRef}
            x={stagePos.x}
            y={stagePos.y}
            scaleX={stageScale}
            scaleY={stageScale}
            draggable
            onDragEnd={handleDragEnd}
          >
            <Layer imageSmoothingEnabled={false}>
              {mapImageStatus === 'loaded' && mapIndex && (
                <Image image={mapImage} x={mapIndex.minX} y={mapIndex.minY} />
              )}

              {drawSettings.specialAreas.draw &&
                visibleSpecialAreas.map((area) => (
                  <Rect
                    key={area.id}
                    x={area.x}
                    y={area.y}
                    width={area.sizeX}
                    height={area.sizeY}
                    fill={drawSettings.specialAreas.fill}
                    stroke={drawSettings.specialAreas.stroke}
                    strokeWidth={0.1}
                    listening={false}
                  />
                ))}

              {drawSettings.path.draw && (
                <Line
                  points={visiblePathPoints}
                  stroke={drawSettings.path.color}
                  strokeWidth={2 / stageScale}
                  lineCap="square"
                  lineJoin="miter"
                  listening={false}
                  shadowColor={MINIMAP_COLORS.SHADOW}
                  shadowBlur={8 / stageScale}
                  shadowOffsetX={0}
                  shadowOffsetY={0}
                  shadowOpacity={0.9}
                />
              )}

              {drawSettings.waypoints.draw &&
                visibleWaypoints.map((waypoint) => {
                  const isSelected = waypoint.id === wptSelection;
                  const isActive = waypoint.id === wptId;
                  const strokeColor = isActive
                    ? MINIMAP_COLORS.WAYPOINT_STATE_STROKE.active
                    : isSelected
                      ? MINIMAP_COLORS.WAYPOINT_STATE_STROKE.selected
                      : MINIMAP_COLORS.WAYPOINT_STATE_STROKE.default;
                  const strokeWidth = isActive ? 0.2 : isSelected ? 0.15 : 0;

                  return (
                    <Rect
                      key={waypoint.id}
                      id={waypoint.id}
                      name="waypoint-marker"
                      x={waypoint.x}
                      y={waypoint.y}
                      width={1}
                      height={1}
                      fill={
                        drawSettings.waypoints.typeColors[waypoint.type] ||
                        MINIMAP_COLORS.WAYPOINT_TYPE.Default
                      }
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      shadowColor={MINIMAP_COLORS.SHADOW}
                      shadowBlur={8 / stageScale}
                      shadowOffsetX={0}
                      shadowOffsetY={0}
                      shadowOpacity={1}
                      onClick={(e) => handleWaypointClick(e, waypoint.id)}
                      onTap={(e) => handleWaypointClick(e, waypoint.id)}
                      onDblClick={() => handleWaypointDoubleClick(waypoint.id)}
                      onDblTap={() => handleWaypointDoubleClick(waypoint.id)}
                      onMouseEnter={(e) => {
                        e.target.getStage().container().style.cursor =
                          'pointer';
                        let tooltipText = waypoint.type;
                        if (waypoint.label?.trim())
                          tooltipText += ` - ${waypoint.label}`;
                        setTooltip({
                          visible: true,
                          x: e.evt.clientX + 15,
                          y: e.evt.clientY,
                          text: tooltipText,
                        });
                      }}
                      onMouseLeave={(e) => {
                        e.target.getStage().container().style.cursor = 'grab';
                        setTooltip({ visible: false, x: 0, y: 0, text: '' });
                      }}
                    />
                  );
                })}

              {drawSettings.player.draw && playerPosition.z === zLevel && (
                <Rect
                  x={playerPosition.x}
                  y={playerPosition.y}
                  name="player-marker"
                  width={1}
                  height={1}
                  fill={drawSettings.player.color}
                  shadowColor={MINIMAP_COLORS.SHADOW}
                  shadowBlur={8 / stageScale}
                  shadowOffsetX={0}
                  shadowOffsetY={0}
                  shadowOpacity={1}
                  listening={false}
                />
              )}

              {/* Render Entities */}
              {drawSettings.entity.draw &&
                visibleEntities.map((entity) => (
                  <Rect
                    key={entity.instanceId}
                    x={entity.gameCoords.x}
                    y={entity.gameCoords.y}
                    width={1}
                    height={1}
                    fill={drawSettings.entity.color}
                    listening={false}
                    shadowColor={MINIMAP_COLORS.SHADOW}
                    shadowBlur={8 / stageScale}
                    shadowOffsetX={0}
                    shadowOffsetY={0}
                    shadowOpacity={0.9}
                  />
                ))}
            </Layer>
          </Stage>
        </div>

        <span
          style={{
            position: 'absolute',
            bottom: 5,
            left: 5,
            background: 'rgba(0,0,0,0.6)',
            color: 'white',
            padding: '2px 5px',
            borderRadius: '3px',
            fontSize: '12px',
            pointerEvents: 'none',
          }}
        >
          {playerTile.x},{playerTile.y},{zLevel}
        </span>

        {tooltip.visible && (
          <div
            style={{
              position: 'fixed',
              top: tooltip.y,
              left: tooltip.x,
              background: 'rgba(0, 0, 0, 0.75)',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              zIndex: 1001,
              pointerEvents: 'none',
            }}
          >
            {tooltip.text}
          </div>
        )}

        {rightClickMenu.visible && (
          <div
            ref={contextMenuRef}
            style={{
              position: 'fixed',
              top: rightClickMenu.y,
              left: rightClickMenu.x,
              zIndex: 1000,
              background: 'rgba(30, 30, 30, 0.9)',
              border: '1px solid #555',
              borderRadius: '4px',
              padding: '4px 0',
              boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
            }}
          >
            {rightClickMenu.stage === 0 && (
              <>
                <div
                  onMouseEnter={() => handleMenuItemHover('waypoints')}
                  onMouseLeave={() => handleMenuItemHover(null)}
                  onClick={() => handleMenuCategorySelect('waypoints')}
                  style={{
                    padding: '6px 15px',
                    color: 'white',
                    fontSize: '13px',
                    cursor: 'pointer',
                    backgroundColor:
                      rightClickMenu.hoveredItem === 'waypoints'
                        ? '#007ACC'
                        : 'transparent',
                  }}
                >
                  Waypoints
                </div>
                <div
                  onMouseEnter={() => handleMenuItemHover('specialAreas')}
                  onMouseLeave={() => handleMenuItemHover(null)}
                  onClick={() => handleMenuCategorySelect('specialAreas')}
                  style={{
                    padding: '6px 15px',
                    color: 'white',
                    fontSize: '13px',
                    cursor: 'pointer',
                    backgroundColor:
                      rightClickMenu.hoveredItem === 'specialAreas'
                        ? '#007ACC'
                        : 'transparent',
                  }}
                >
                  Special Areas
                </div>
              </>
            )}

            {rightClickMenu.stage === 1 && (
              <>
                {waypointCount < MAX_WAYPOINTS_PER_SECTION ? (
                  WAYPOINT_TYPE_OPTIONS.map((option) => (
                    <div
                      key={option.value}
                      onClick={() => handleMenuItemClick(option.value)}
                      onMouseEnter={() => handleMenuItemHover(option.value)}
                      onMouseLeave={() => handleMenuItemHover(null)}
                      style={{
                        padding: '6px 15px',
                        color: 'white',
                        fontSize: '13px',
                        cursor: 'pointer',
                        backgroundColor:
                          rightClickMenu.hoveredItem === option.value
                            ? '#007ACC'
                            : 'transparent',
                      }}
                    >
                      {`Add ${option.label}`}
                    </div>
                  ))
                ) : (
                  <div
                    style={{
                      padding: '6px 15px',
                      color: '#FF5555',
                      fontSize: '13px',
                      fontWeight: 'bold',
                      cursor: 'not-allowed',
                    }}
                  >
                    Limit Reached ({MAX_WAYPOINTS_PER_SECTION})
                  </div>
                )}
                {rightClickMenu.targetWaypointId && (
                  <div
                    onClick={() => handleMenuItemClick('RemoveWaypoint')}
                    onMouseEnter={() => handleMenuItemHover('RemoveWaypoint')}
                    onMouseLeave={() => handleMenuItemHover(null)}
                    style={{
                      padding: '6px 15px',
                      color: '#FF5555',
                      fontWeight: 'bold',
                      fontSize: '13px',
                      cursor: 'pointer',
                      backgroundColor:
                        rightClickMenu.hoveredItem === 'RemoveWaypoint'
                          ? '#B22222'
                          : 'transparent',
                      marginTop: '4px',
                      borderTop: '1px solid #555',
                    }}
                  >
                    Remove Waypoint
                  </div>
                )}
              </>
            )}

            {rightClickMenu.stage === 2 && (
              <>
                {SPECIAL_AREA_TYPE_OPTIONS.map((option) => (
                  <div
                    key={option.value}
                    onClick={() => handleMenuItemClick(option.value)}
                    onMouseEnter={() => handleMenuItemHover(option.value)}
                    onMouseLeave={() => handleMenuItemHover(null)}
                    style={{
                      padding: '6px 15px',
                      color: 'white',
                      fontSize: '13px',
                      cursor: 'pointer',
                      backgroundColor:
                        rightClickMenu.hoveredItem === option.value
                          ? '#007ACC'
                          : 'transparent',
                    }}
                  >
                    {`Add ${option.label}`}
                  </div>
                ))}
                {rightClickMenu.targetSpecialAreaId && (
                  <div
                    onClick={() => handleMenuItemClick('RemoveSpecialArea')}
                    onMouseEnter={() =>
                      handleMenuItemHover('RemoveSpecialArea')
                    }
                    onMouseLeave={() => handleMenuItemHover(null)}
                    style={{
                      padding: '6px 15px',
                      color: '#FF5555',
                      fontWeight: 'bold',
                      fontSize: '13px',
                      cursor: 'pointer',
                      backgroundColor:
                        rightClickMenu.hoveredItem === 'RemoveSpecialArea'
                          ? '#B22222'
                          : 'transparent',
                      marginTop: '4px',
                      borderTop: '1px solid #555',
                    }}
                  >
                    Remove Special Area
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <MinimapSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={handleCloseModal}
        settings={drawSettings}
        onChange={setDrawSettings}
      />
    </StyledMinimap>
  );
};

export default Minimap;
