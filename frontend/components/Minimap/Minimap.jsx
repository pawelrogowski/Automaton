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
  SettingGroup,
  GroupTitle,
  SettingRow,
  ControlLabel,
  ColorInput,
  ContextMenu,
  ContextMenuItem,
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
    label: 'CAV - 255',
    type: 'cavebot',
    avoidance: 255,
  },
  {
    value: 'cavebot_20',
    label: 'CAV - 20',
    type: 'cavebot',
    avoidance: 20,
  },
  {
    value: 'targeting_255',
    label: 'TAR - 255',
    type: 'targeting',
    avoidance: 255,
  },
  {
    value: 'targeting_20',
    label: 'TAR - 20',
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

    const handleSpecialAreaColorChange = (areaType, colorType, value) => {
      onChange((prev) => ({
        ...prev,
        specialAreas: {
          ...prev.specialAreas,
          [areaType]: {
            ...prev.specialAreas[areaType],
            [colorType]: value,
          },
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
            {/* Basic Elements Group */}
            <SettingGroup>
              <GroupTitle>Basic Elements</GroupTitle>

              <SettingRow>
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
              </SettingRow>

              <SettingRow>
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
              </SettingRow>

              <SettingRow>
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
              </SettingRow>
            </SettingGroup>

            {/* Special Areas Group */}
            <SettingGroup>
              <GroupTitle>
                Special Areas
                <CustomSwitch
                  checked={settings.specialAreas.draw}
                  onChange={() => handleToggle('specialAreas')}
                />
              </GroupTitle>

              <SettingRow>
                <ControlLabel isSub>Cavebot (Blue)</ControlLabel>
                <ColorInput
                  value={settings.specialAreas.cavebot.fill}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    handleSpecialAreaColorChange(
                      'cavebot',
                      'fill',
                      e.target.value,
                    )
                  }
                  title="Fill color"
                />
              </SettingRow>

              <SettingRow>
                <ControlLabel isSub>Targeting (Purple)</ControlLabel>
                <ColorInput
                  value={settings.specialAreas.targeting.fill}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    handleSpecialAreaColorChange(
                      'targeting',
                      'fill',
                      e.target.value,
                    )
                  }
                  title="Fill color"
                />
              </SettingRow>
            </SettingGroup>

            {/* Waypoints Group */}
            <SettingGroup>
              <GroupTitle>
                Waypoints
                <CustomSwitch
                  checked={settings.waypoints.draw}
                  onChange={() => handleToggle('waypoints')}
                />
              </GroupTitle>

              {WAYPOINT_TYPE_OPTIONS.map((opt) => (
                <SettingRow key={opt.value}>
                  <ControlLabel isSub>{opt.label}</ControlLabel>
                  <ColorInput
                    value={settings.waypoints.typeColors[opt.value]}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      handleWaypointColorChange(opt.value, e.target.value)
                    }
                  />
                </SettingRow>
              ))}
            </SettingGroup>
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
    waypointCount,
    wptSelection,
    wptId,
    cavebotPathWaypoints,
    targetingPathWaypoints,
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
      waypointCount: currentWaypoints.length,
      wptSelection: state.cavebot.wptSelection,
      wptId: state.cavebot.wptId,
      // Use explicit dual channels from pathfinder slice
      cavebotPathWaypoints: state.pathfinder.cavebotPathWaypoints || [],
      targetingPathWaypoints: state.pathfinder.targetingPathWaypoints || [],
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
  const [resizeMode, setResizeMode] = useState(false);
  const [resizingArea, setResizingArea] = useState(null);
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
        cavebot: MINIMAP_COLORS.SPECIAL_AREA.cavebot,
        targeting: MINIMAP_COLORS.SPECIAL_AREA.targeting,
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
  // Cavebot path (primary movement / cavebot visualization)
  const visibleCavebotPathPoints = useMemo(
    () =>
      (cavebotPathWaypoints || [])
        .filter((p) => p.z === zLevel)
        .flatMap((p) => [p.x + 0.5, p.y + 0.5]),
    [cavebotPathWaypoints, zLevel],
  );

  // Targeting path (separate overlay for targeting/debugging)
  const visibleTargetingPathPoints = useMemo(
    () =>
      (targetingPathWaypoints || [])
        .filter((p) => p.z === zLevel)
        .flatMap((p) => [p.x + 0.5, p.y + 0.5]),
    [targetingPathWaypoints, zLevel],
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
    [creatures, zLevel],
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
  const handleZChange = useCallback((delta) => {
    setIsLockedToPlayer(false);
    setZLevel((prevZ) => Math.max(0, Math.min(15, prevZ + delta)));
  }, []);
  const handleLockToggle = useCallback(
    () => setIsLockedToPlayer((prev) => !prev),
    [],
  );
  const handleFullscreenToggle = useCallback(() => {
    if (!minimapContainerRef.current) return;
    if (isFullscreen)
      document.exitFullscreen().catch((err) => console.error(err));
    else
      minimapContainerRef.current
        .requestFullscreen()
        .catch((err) => console.error(err));
  }, [isFullscreen]);
  const handleMapModeToggle = useCallback(
    () => setMapMode((prevMode) => (prevMode === 'map' ? 'waypoint' : 'map')),
    [],
  );

  const handleCloseModal = useCallback(() => {
    setIsSettingsModalOpen(false);
  }, []);

  // --- Konva Event Handlers ---
  const handleWheel = useCallback((e) => {
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
  }, []);
  const handleDragEnd = useCallback((e) => {
    setIsLockedToPlayer(false);
    setStagePos(e.target.position());
  }, []);

  const handleContextMenu = useCallback(
    (e) => {
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

      // Use viewport dimensions for better positioning
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const clickX = e.evt.clientX;
      const clickY = e.evt.clientY;

      const menuWidth = 200;
      const padding = 10;

      // Position menu intelligently
      // Prefer right and down, but flip if not enough space
      let menuX = clickX + padding;
      let menuY = clickY + padding;

      // Check if menu would overflow right edge
      if (menuX + menuWidth > viewportWidth - padding) {
        // Flip to left of cursor
        menuX = clickX - menuWidth - padding;
      }

      // Ensure menu doesn't go off left edge
      if (menuX < padding) {
        menuX = padding;
      }

      // For Y position, we'll let the menu handle overflow with max-height and scroll
      // But ensure it starts on screen
      if (menuY < padding) {
        menuY = padding;
      }

      setRightClickMenu({
        visible: true,
        x: menuX,
        y: menuY,
        stage: 0, // Always start at the main category selection
        selectedCategory: null,
        targetPos: targetPos,
        targetWaypointId: existingWaypoint ? existingWaypoint.id : null,
        targetSpecialAreaId: existingSpecialArea
          ? existingSpecialArea.id
          : null,
        hoveredItem: null,
      });
    },
    [mapIndex, zLevel, visibleWaypoints, visibleSpecialAreas],
  );

  const handleMenuItemHover = useCallback(
    (item) => setRightClickMenu((prev) => ({ ...prev, hoveredItem: item })),
    [],
  );

  const handleMenuCategorySelect = useCallback((category) => {
    setRightClickMenu((prev) => ({
      ...prev,
      stage: category === 'waypoints' ? 1 : 2,
      selectedCategory: category,
      hoveredItem: null,
    }));
  }, []);

  const handleMenuItemClick = useCallback(
    (item) => {
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
    },
    [dispatch, rightClickMenu],
  );

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

  const handleWaypointClick = useCallback(
    (e, waypointId) => {
      if (e.evt.button !== 2) dispatch(setwptSelection(waypointId));
    },
    [dispatch],
  );
  const handleWaypointDoubleClick = useCallback(
    (waypointId) => dispatch(setwptId(waypointId)),
    [dispatch],
  );

  const handleSpecialAreaClick = useCallback(
    (e, areaId) => {
      if (!resizeMode || e.evt.button === 2) return;

      // If we're already resizing, let the click propagate to handleStageClick to finish
      if (resizingArea) {
        return;
      }

      // Starting a new resize
      e.evt.preventDefault();
      e.cancelBubble = true;

      const area = visibleSpecialAreas.find((a) => a.id === areaId);
      if (!area) return;

      setIsLockedToPlayer(false);
      setResizingArea({
        id: areaId,
        startX: area.x,
        startY: area.y,
        originalSizeX: area.sizeX,
        originalSizeY: area.sizeY,
      });
    },
    [resizeMode, visibleSpecialAreas, resizingArea],
  );

  const handleStageMouseMove = useCallback(
    (e) => {
      if (!resizingArea || !resizeMode) return;

      const stage = e.target.getStage();
      const pointerPos = stage.getPointerPosition();
      if (!pointerPos) return;

      const worldX = Math.floor((pointerPos.x - stage.x()) / stage.scaleX());
      const worldY = Math.floor((pointerPos.y - stage.y()) / stage.scaleY());

      // Calculate new size based on cursor position
      const newSizeX = Math.max(1, worldX - resizingArea.startX + 1);
      const newSizeY = Math.max(1, worldY - resizingArea.startY + 1);

      // Store preview size without dispatching to Redux yet
      setResizingArea((prev) => ({
        ...prev,
        previewSizeX: newSizeX,
        previewSizeY: newSizeY,
      }));
    },
    [resizingArea, resizeMode],
  );

  const handleStageClick = useCallback(
    (e) => {
      if (!resizeMode) return;

      // If we're already resizing, finish the resize
      if (resizingArea) {
        const stage = e.target.getStage();
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) return;

        const worldX = Math.floor((pointerPos.x - stage.x()) / stage.scaleX());
        const worldY = Math.floor((pointerPos.y - stage.y()) / stage.scaleY());

        // Calculate final size
        const newSizeX = Math.max(1, worldX - resizingArea.startX + 1);
        const newSizeY = Math.max(1, worldY - resizingArea.startY + 1);

        // Apply the resize
        dispatch(
          updateSpecialArea({
            id: resizingArea.id,
            updates: { sizeX: newSizeX, sizeY: newSizeY },
          }),
        );

        // Clear resizing state
        setResizingArea(null);
      }
    },
    [resizeMode, resizingArea, dispatch],
  );

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') handleLockToggle();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleLockToggle]);

  return (
    <StyledMinimap ref={minimapContainerRef} tabIndex={0}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: isFullscreen ? '100vh' : CANVAS_SIZE,
        }}
      >
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
              onClick={() => setResizeMode((prev) => !prev)}
              active={resizeMode}
              title="Resize Special Area Mode"
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
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
              </svg>
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
            onMouseMove={handleStageMouseMove}
            onClick={handleStageClick}
            ref={stageRef}
            x={stagePos.x}
            y={stagePos.y}
            scaleX={stageScale}
            scaleY={stageScale}
            draggable={!resizingArea}
            onDragEnd={handleDragEnd}
          >
            <Layer imageSmoothingEnabled={false}>
              {mapImageStatus === 'loaded' && mapIndex && (
                <Image image={mapImage} x={mapIndex.minX} y={mapIndex.minY} />
              )}

              {drawSettings.specialAreas.draw &&
                visibleSpecialAreas.map((area) => {
                  const isResizing = resizingArea?.id === area.id;
                  const displaySizeX =
                    isResizing && resizingArea.previewSizeX
                      ? resizingArea.previewSizeX
                      : area.sizeX;
                  const displaySizeY =
                    isResizing && resizingArea.previewSizeY
                      ? resizingArea.previewSizeY
                      : area.sizeY;

                  // Get colors based on area type
                  const areaType = area.type || 'cavebot';
                  const typeColors =
                    drawSettings.specialAreas[areaType] ||
                    drawSettings.specialAreas.cavebot;

                  if (area.hollow) {
                    // Render hollow area as individual border tiles
                    const borderTiles = [];

                    // Top and bottom rows
                    for (let dx = 0; dx < displaySizeX; dx++) {
                      borderTiles.push({ x: area.x + dx, y: area.y }); // top
                      if (displaySizeY > 1) {
                        borderTiles.push({
                          x: area.x + dx,
                          y: area.y + displaySizeY - 1,
                        }); // bottom
                      }
                    }

                    // Left and right columns (excluding corners)
                    for (let dy = 1; dy < displaySizeY - 1; dy++) {
                      borderTiles.push({ x: area.x, y: area.y + dy }); // left
                      if (displaySizeX > 1) {
                        borderTiles.push({
                          x: area.x + displaySizeX - 1,
                          y: area.y + dy,
                        }); // right
                      }
                    }

                    return (
                      <React.Fragment key={area.id}>
                        {borderTiles.map((tile, idx) => (
                          <Rect
                            key={`${area.id}-tile-${idx}`}
                            x={tile.x}
                            y={tile.y}
                            width={1}
                            height={1}
                            fill={typeColors.fill}
                            stroke={isResizing ? '#00ff00' : typeColors.stroke}
                            strokeWidth={isResizing ? 0.2 : 0.1}
                            listening={resizeMode}
                            onClick={(e) =>
                              resizeMode && handleSpecialAreaClick(e, area.id)
                            }
                            onTap={(e) =>
                              resizeMode && handleSpecialAreaClick(e, area.id)
                            }
                            onMouseEnter={(e) => {
                              if (resizeMode) {
                                e.target.getStage().container().style.cursor =
                                  'nwse-resize';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (resizeMode && !resizingArea) {
                                e.target.getStage().container().style.cursor =
                                  'grab';
                              }
                            }}
                          />
                        ))}
                      </React.Fragment>
                    );
                  } else {
                    // Render filled area as a single rectangle
                    return (
                      <Rect
                        key={area.id}
                        x={area.x}
                        y={area.y}
                        width={displaySizeX}
                        height={displaySizeY}
                        fill={typeColors.fill}
                        stroke={isResizing ? '#00ff00' : typeColors.stroke}
                        strokeWidth={isResizing ? 0.2 : 0.1}
                        listening={resizeMode}
                        onClick={(e) =>
                          resizeMode && handleSpecialAreaClick(e, area.id)
                        }
                        onTap={(e) =>
                          resizeMode && handleSpecialAreaClick(e, area.id)
                        }
                        onMouseEnter={(e) => {
                          if (resizeMode) {
                            e.target.getStage().container().style.cursor =
                              'nwse-resize';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (resizeMode && !resizingArea) {
                            e.target.getStage().container().style.cursor =
                              'grab';
                          }
                        }}
                      />
                    );
                  }
                })}

              {drawSettings.path.draw && visibleCavebotPathPoints.length > 0 && (
                <Line
                  points={visibleCavebotPathPoints}
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

              {/* Optional: targeting path overlay if provided */}
              {drawSettings.path.draw &&
                visibleTargetingPathPoints.length > 0 && (
                  <Line
                    points={visibleTargetingPathPoints}
                    stroke={MINIMAP_COLORS.TARGETING_PATH || '#ff00ff'}
                    strokeWidth={1.5 / stageScale}
                    lineCap="square"
                    lineJoin="miter"
                    listening={false}
                    dash={[4 / stageScale, 4 / stageScale]}
                    shadowColor={MINIMAP_COLORS.SHADOW}
                    shadowBlur={6 / stageScale}
                    shadowOffsetX={0}
                    shadowOffsetY={0}
                    shadowOpacity={0.8}
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

        {resizeMode && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              background: 'rgba(0, 255, 0, 0.15)',
              border: '2px solid #00ff00',
              color: '#00ff00',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 'bold',
              pointerEvents: 'none',
              backdropFilter: 'blur(8px)',
            }}
          >
            {resizingArea
              ? 'Move cursor and click to finish resize'
              : 'Resize Mode: Click area to start'}
          </div>
        )}

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
          <ContextMenu
            ref={contextMenuRef}
            style={{
              top: rightClickMenu.y,
              left: rightClickMenu.x,
            }}
          >
            {rightClickMenu.stage === 0 && (
              <>
                <ContextMenuItem
                  onMouseEnter={() => handleMenuItemHover('waypoints')}
                  onMouseLeave={() => handleMenuItemHover(null)}
                  onClick={() => handleMenuCategorySelect('waypoints')}
                  isHovered={rightClickMenu.hoveredItem === 'waypoints'}
                >
                  Waypoints
                </ContextMenuItem>
                <ContextMenuItem
                  onMouseEnter={() => handleMenuItemHover('specialAreas')}
                  onMouseLeave={() => handleMenuItemHover(null)}
                  onClick={() => handleMenuCategorySelect('specialAreas')}
                  isHovered={rightClickMenu.hoveredItem === 'specialAreas'}
                >
                  Special Areas
                </ContextMenuItem>
              </>
            )}

            {rightClickMenu.stage === 1 && (
              <>
                {waypointCount < MAX_WAYPOINTS_PER_SECTION ? (
                  WAYPOINT_TYPE_OPTIONS.map((option) => (
                    <ContextMenuItem
                      key={option.value}
                      onClick={() => handleMenuItemClick(option.value)}
                      onMouseEnter={() => handleMenuItemHover(option.value)}
                      onMouseLeave={() => handleMenuItemHover(null)}
                      isHovered={rightClickMenu.hoveredItem === option.value}
                    >
                      {`Add ${option.label}`}
                    </ContextMenuItem>
                  ))
                ) : (
                  <ContextMenuItem color="#FF5555" bold disabled>
                    Limit Reached ({MAX_WAYPOINTS_PER_SECTION})
                  </ContextMenuItem>
                )}
                {rightClickMenu.targetWaypointId && (
                  <ContextMenuItem
                    onClick={() => handleMenuItemClick('RemoveWaypoint')}
                    onMouseEnter={() => handleMenuItemHover('RemoveWaypoint')}
                    onMouseLeave={() => handleMenuItemHover(null)}
                    color="#FF5555"
                    bold
                    separator
                    dangerHover
                    isHovered={rightClickMenu.hoveredItem === 'RemoveWaypoint'}
                  >
                    Remove Waypoint
                  </ContextMenuItem>
                )}
              </>
            )}

            {rightClickMenu.stage === 2 && (
              <>
                {SPECIAL_AREA_TYPE_OPTIONS.map((option) => (
                  <ContextMenuItem
                    key={option.value}
                    onClick={() => handleMenuItemClick(option.value)}
                    onMouseEnter={() => handleMenuItemHover(option.value)}
                    onMouseLeave={() => handleMenuItemHover(null)}
                    isHovered={rightClickMenu.hoveredItem === option.value}
                  >
                    {`Add ${option.label}`}
                  </ContextMenuItem>
                ))}
                {rightClickMenu.targetSpecialAreaId && (
                  <ContextMenuItem
                    onClick={() => handleMenuItemClick('RemoveSpecialArea')}
                    onMouseEnter={() =>
                      handleMenuItemHover('RemoveSpecialArea')
                    }
                    onMouseLeave={() => handleMenuItemHover(null)}
                    color="#FF5555"
                    bold
                    separator
                    dangerHover
                    isHovered={
                      rightClickMenu.hoveredItem === 'RemoveSpecialArea'
                    }
                  >
                    Remove Special Area
                  </ContextMenuItem>
                )}
              </>
            )}
          </ContextMenu>
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
