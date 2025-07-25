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
} from './Minimap.styled.js';
import {
  addWaypoint,
  removeWaypoint,
  setwptId,
  setwptSelection,
} from '../../redux/slices/cavebotSlice.js';
import { MINIMAP_COLORS } from './colors.js';

// --- Constants ---
const CANVAS_SIZE = 500;
const MIN_ZOOM = 2;
const MAX_ZOOM = 50;

const WAYPOINT_TYPE_OPTIONS = [
  { value: 'Node', label: 'Node' },
  { value: 'Stand', label: 'Stand' },
  { value: 'Ladder', label: 'Ladder' },
  { value: 'Script', label: 'Script' },
  { value: 'Lure', label: 'Lure' },
];

// --- Component ---
const Minimap = () => {
  const dispatch = useDispatch();
  const stageRef = useRef(null);
  const minimapContainerRef = useRef(null);

  // --- Redux State ---
  const playerPosition = useSelector(
    (state) => state.gameState.playerMinimapPosition,
  );
  const currentSection = useSelector((state) => state.cavebot.currentSection);
  const allWaypoints = useSelector(
    (state) => state.cavebot.waypointSections[currentSection]?.waypoints || [],
  );
  const wptSelection = useSelector((state) => state.cavebot.wptSelection);
  const wptId = useSelector((state) => state.cavebot.wptId);
  const allPathWaypoints = useSelector((state) => state.cavebot.pathWaypoints);
  const specialAreas = useSelector((state) => state.cavebot.specialAreas);

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
    type: null,
    targetPos: null,
    targetId: null,
    hoveredType: null,
  });
  const [isLockedToPlayer, setIsLockedToPlayer] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canvasDimensions, setCanvasDimensions] = useState({
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
  });

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

  const handleMouseDown = (e) => {
    if (e.evt.button !== 2) return;
    e.evt.preventDefault();

    if (e.target.name() === 'player-marker') {
      return; // Do not show context menu for the player marker
    }

    const stage = e.target.getStage();
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    if (e.target.name() === 'waypoint-marker') {
      const waypointId = e.target.id();
      setRightClickMenu({
        visible: true,
        x: e.evt.clientX,
        y: e.evt.clientY,
        type: 'delete',
        targetId: waypointId,
        targetPos: null,
        hoveredType: null,
      });
    } else {
      if (!mapIndex) return;
      const worldX = Math.floor((pointerPos.x - stage.x()) / stage.scaleX());
      const worldY = Math.floor((pointerPos.y - stage.y()) / stage.scaleY());
      setRightClickMenu({
        visible: true,
        x: e.evt.clientX,
        y: e.evt.clientY,
        type: 'add',
        targetId: null,
        targetPos: { x: worldX, y: worldY, z: zLevel },
        hoveredType: null,
      });
    }
  };

  const handleMenuItemHover = (itemType) =>
    setRightClickMenu((prev) => ({ ...prev, hoveredType: itemType }));

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (!rightClickMenu.visible) return;
      if (
        rightClickMenu.type === 'add' &&
        rightClickMenu.hoveredType &&
        rightClickMenu.targetPos
      ) {
        dispatch(
          addWaypoint({
            id: uuidv4(),
            type: rightClickMenu.hoveredType,
            ...rightClickMenu.targetPos,
            range: 1,
            action:
              rightClickMenu.hoveredType === 'Script'
                ? 'Enter your script'
                : '',
          }),
        );
      } else if (
        rightClickMenu.type === 'delete' &&
        rightClickMenu.hoveredType === 'Delete' &&
        rightClickMenu.targetId
      ) {
        dispatch(removeWaypoint(rightClickMenu.targetId));
      }
      setRightClickMenu({
        visible: false,
        x: 0,
        y: 0,
        type: null,
        targetPos: null,
        targetId: null,
        hoveredType: null,
      });
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [rightClickMenu, dispatch]);

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
    <StyledMinimap
      ref={minimapContainerRef}
      style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
      tabIndex={0}
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
      </StyledMapControls>
      <div
        style={{
          width: '100%',
          height: '100%',
          cursor: 'grab',
          background: '#222',
        }}
      >
        <Stage
          width={canvasDimensions.width}
          height={canvasDimensions.height}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onContextMenu={(e) => e.evt.preventDefault()}
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

            {visibleSpecialAreas.map((area) => (
              <Rect
                key={area.id}
                x={area.x}
                y={area.y}
                width={area.sizeX}
                height={area.sizeY}
                fill={MINIMAP_COLORS.SPECIAL_AREA.fill}
                stroke={MINIMAP_COLORS.SPECIAL_AREA.stroke}
                strokeWidth={0.1}
                listening={false}
              />
            ))}

            <Line
              points={visiblePathPoints}
              stroke={MINIMAP_COLORS.PATH}
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

            {visibleWaypoints.map((waypoint) => {
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
                    MINIMAP_COLORS.WAYPOINT_TYPE[waypoint.type] ||
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
                    e.target.getStage().container().style.cursor = 'pointer';
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

            {playerPosition.z === zLevel && (
              <Rect
                x={playerPosition.x}
                y={playerPosition.y}
                name="player-marker"
                width={1}
                height={1}
                fill={MINIMAP_COLORS.PLAYER}
                shadowColor={MINIMAP_COLORS.SHADOW}
                shadowBlur={8 / stageScale}
                shadowOffsetX={0}
                shadowOffsetY={0}
                shadowOpacity={1}
              />
            )}
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
          {rightClickMenu.type === 'add' &&
            WAYPOINT_TYPE_OPTIONS.map((option) => (
              <div
                key={option.value}
                onMouseEnter={() => handleMenuItemHover(option.value)}
                onMouseLeave={() => handleMenuItemHover(null)}
                style={{
                  padding: '6px 15px',
                  color: 'white',
                  fontSize: '13px',
                  cursor: 'pointer',
                  backgroundColor:
                    rightClickMenu.hoveredType === option.value
                      ? '#007ACC'
                      : 'transparent',
                }}
              >
                {option.label}
              </div>
            ))}
          {rightClickMenu.type === 'delete' && (
            <div
              onMouseEnter={() => handleMenuItemHover('Delete')}
              onMouseLeave={() => handleMenuItemHover(null)}
              style={{
                padding: '6px 15px',
                color: '#FF5555',
                fontWeight: 'bold',
                fontSize: '13px',
                cursor: 'pointer',
                backgroundColor:
                  rightClickMenu.hoveredType === 'Delete'
                    ? '#B22222'
                    : 'transparent',
              }}
            >
              Delete
            </div>
          )}
        </div>
      )}
    </StyledMinimap>
  );
};

export default Minimap;
