import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { Trash2, Plus, Sliders } from 'react-feather';
import { useSelector, useDispatch, shallowEqual } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';
import {
  reorderWaypoints,
  setwptSelection,
  updateWaypoint,
  setwptId,
  addWaypointSection,
  removeWaypointSection,
  setCurrentWaypointSection,
  renameWaypointSection,
  addSpecialArea,
  removeSpecialArea,
  updateSpecialArea,
  removeWaypoint,
} from '../../redux/slices/cavebotSlice.js';
import { MAX_WAYPOINTS_PER_SECTION } from '../../redux/slices/cavebotSlice.js';
import { useTable, useBlockLayout, useResizeColumns } from 'react-table';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useDrag, useDrop } from 'react-dnd';
import { throttle } from 'lodash';
import {
  StyledWaypointTable,
  SectionButtonsContainer,
  SectionButton,
  SectionManagementRow,
  AddSectionButton,
  RemoveSectionButton,
  SectionNameInput,
  ModeSwitchButton,
} from './WaypointTable.styled.js';
import LuaEditorModal from '../luaEditorModal/luaEditorModal.js';

const DraggableRow = React.memo(
  ({
    index,
    row,
    children,
    isSelected,
    isActive,
    onSelect,
    onMoveRow,
    setRef,
    onContextMenu,
  }) => {
    const [{ isDragging }, drag] = useDrag({
      type: 'row',
      item: { index },
      canDrag: !!onMoveRow,
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    });

    const [, drop] = useDrop({
      accept: 'row',
      hover: (item) => {
        if (!onMoveRow || item.index === index) return;
        onMoveRow(item.index, index);
        item.index = index;
      },
    });

    const combinedRef = (node) => {
      setRef(node);
      if (onMoveRow) drag(drop(node));
    };

    const classNames = ['tr'];
    if (isSelected) classNames.push('selected');
    if (isActive) classNames.push('active-bot-wp');

    return (
      <div
        ref={combinedRef}
        style={{ opacity: isDragging ? 0.5 : 1 }}
        {...row.getRowProps()}
        className={classNames.join(' ')}
        onClick={() => onSelect(row.original.id)}
        onContextMenu={(e) => {
          if (onContextMenu) {
            e.preventDefault();
            onContextMenu(row.original.id);
          }
        }}
      >
        {children}
      </div>
    );
  },
);

const EditableStringCell = React.memo(
  ({
    value: initialValue,
    row: { original },
    column: { id },
    updateMyData,
  }) => {
    const [value, setValue] = useState(initialValue);
    const [isEditing, setIsEditing] = useState(false);
    const onBlur = () => {
      setIsEditing(false);
      if (initialValue !== value) updateMyData(original.id, { [id]: value });
    };
    useEffect(() => {
      setValue(initialValue);
    }, [initialValue]);
    if (isEditing)
      return (
        <input
          value={value || ''}
          onChange={(e) => setValue(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onBlur();
          }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      );
    return (
      <div
        onDoubleClick={() => setIsEditing(true)}
        style={{ width: '100%', height: '100%' }}
      >
        {value || <span> </span>}
      </div>
    );
  },
);

const EditableSelectCell = React.memo(
  ({
    value: initialValue,
    row: { original },
    column: { id, options },
    updateMyData,
  }) => {
    const [isEditing, setIsEditing] = useState(false);
    const onChange = (e) => {
      updateMyData(original.id, { [id]: e.target.value });
      setIsEditing(false);
    };
    if (isEditing)
      return (
        <select
          value={initialValue}
          onChange={onChange}
          onBlur={() => setIsEditing(false)}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    return (
      <div
        onDoubleClick={() => setIsEditing(true)}
        style={{ width: '100%', height: '100%' }}
      >
        {initialValue}
      </div>
    );
  },
);

const EditableNumberCell = React.memo(
  ({
    value: initialValue,
    row: { original },
    column: { id },
    updateMyData,
  }) => {
    const [value, setValue] = useState(initialValue);
    const [isEditing, setIsEditing] = useState(false);
    const onBlur = () => {
      setIsEditing(false);
      const p = parseInt(value, 10);
      if (!isNaN(p) && p !== initialValue)
        updateMyData(original.id, { [id]: p });
      else setValue(initialValue);
    };
    useEffect(() => {
      setValue(initialValue);
    }, [initialValue]);
    if (isEditing)
      return (
        <input
          type="number"
          value={value || 0}
          onChange={(e) => setValue(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onBlur();
          }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      );
    return (
      <div
        onDoubleClick={() => setIsEditing(true)}
        style={{ width: '100%', height: '100%' }}
      >
        {initialValue}
      </div>
    );
  },
);

const EditableCoordinatesCell = React.memo(
  ({ row: { original }, updateMyData }) => {
    const [coords, setCoords] = useState({
      x: original.x,
      y: original.y,
      z: original.z,
    });
    const [isEditing, setIsEditing] = useState(false);
    const onChange = (e, coord) =>
      setCoords((prev) => ({ ...prev, [coord]: e.target.value }));
    const onBlurContainer = (e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return;
      setIsEditing(false);
      const u = {
        x: parseInt(coords.x, 10) || 0,
        y: parseInt(coords.y, 10) || 0,
        z: parseInt(coords.z, 10) || 0,
      };
      if (u.x !== original.x || u.y !== original.y || u.z !== original.z)
        updateMyData(original.id, u);
    };
    useEffect(() => {
      setCoords({ x: original.x, y: original.y, z: original.z });
    }, [original.x, original.y, original.z]);
    if (isEditing)
      return (
        <div
          onBlur={onBlurContainer}
          className="coord-editor"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="number"
            value={coords.x}
            onChange={(e) => onChange(e, 'x')}
            autoFocus
          />
          <input
            type="number"
            value={coords.y}
            onChange={(e) => onChange(e, 'y')}
          />
          <input
            type="number"
            value={coords.z}
            onChange={(e) => onChange(e, 'z')}
          />
        </div>
      );
    return (
      <div
        onDoubleClick={() => setIsEditing(true)}
        style={{ width: '100%', height: '100%' }}
      >{`${original.x}, ${original.y}, ${original.z}`}</div>
    );
  },
);

// --- MODIFICATION: Renamed for clarity ---
const LuaScriptCell = React.memo(
  ({ value, row: { original }, onEditAction }) => {
    const isScriptType = original.type === 'Script';
    const isEditable = isScriptType;

    return (
      <div
        onDoubleClick={() => isEditable && onEditAction(original)}
        style={{
          width: '100%',
          height: '100%',
          cursor: isEditable ? 'pointer' : 'default',
          opacity: isEditable ? 1 : 0.5,
        }}
        title={
          isEditable
            ? 'Double-click to edit script'
            : 'Only available for Script type waypoints'
        }
      >
        {value && isScriptType ? (
          <pre
            style={{
              margin: 0,
              padding: '2px',
              whiteSpace: 'pre',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {value}
          </pre>
        ) : isScriptType ? (
          <span style={{ color: '#888', fontStyle: 'italic' }}>
            Double-click to add script...
          </span>
        ) : (
          <span style={{ color: '#666', fontStyle: 'italic' }}>N/A</span>
        )}
      </div>
    );
  },
);
// --- END MODIFICATION ---

const EditableCheckboxCell = React.memo(
  ({
    value: initialValue,
    row: { original },
    column: { id },
    updateMyData,
  }) => (
    <input
      type="checkbox"
      checked={!!initialValue}
      onChange={(e) => updateMyData(original.id, { [id]: e.target.checked })}
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'block', margin: 'auto' }}
    />
  ),
);

const ActionCell = React.memo(({ row: { original }, onRemove }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
    }}
  >
    <Trash2
      size={16}
      onClick={(e) => {
        e.stopPropagation();
        onRemove(original.id);
      }}
      style={{ cursor: 'pointer' }}
    />
  </div>
));

const WaypointTable = () => {
  const dispatch = useDispatch();
  const [viewMode, setViewMode] = useState('waypoints');
  const [modalState, setModalState] = useState({
    isOpen: false,
    waypoint: null,
  });
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [editingSectionName, setEditingSectionName] = useState('');
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    sectionId: null,
  });

  const {
    waypointSections,
    currentSectionId,
    waypoints,
    waypointCount, // Add waypointCount to state
    wptSelection,
    wptId,
    specialAreas,
    playerPosition,
  } = useSelector((state) => {
    const currentWaypoints =
      state.cavebot.waypointSections[state.cavebot.currentSection]?.waypoints ||
      [];
    return {
      waypointSections: state.cavebot.waypointSections,
      currentSectionId: state.cavebot.currentSection,
      waypoints: currentWaypoints,
      waypointCount: currentWaypoints.length, // Get waypoint count
      wptSelection: state.cavebot.wptSelection,
      wptId: state.cavebot.wptId,
      specialAreas: state.cavebot.specialAreas,
      playerPosition: state.gameState.playerMinimapPosition,
    };
  }, shallowEqual);

  const sectionInputRef = useRef(null);
  const rowRefs = useRef(new Map());

  useEffect(() => {
    if (viewMode === 'waypoints') {
      const id = wptSelection || wptId;
      const node = rowRefs.current.get(id);
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [wptSelection, wptId, currentSectionId, viewMode]);

  const throttledReorder = useMemo(
    () =>
      throttle(
        (dragIndex, hoverIndex) =>
          dispatch(
            reorderWaypoints({ startIndex: dragIndex, endIndex: hoverIndex }),
          ),
        100,
        {
          leading: true,
          trailing: false,
        },
      ),
    [dispatch],
  );
  const handleMoveRow = useCallback(
    (d, h) => throttledReorder(d, h),
    [throttledReorder],
  );
  const updateWaypointData = useCallback(
    (id, u) => dispatch(updateWaypoint({ id, updates: u })),
    [dispatch],
  );
  const updateSpecialAreaData = useCallback(
    (id, u) => dispatch(updateSpecialArea({ id, updates: u })),
    [dispatch],
  );
  const handleSelectRow = useCallback(
    (id) => {
      if (!/INPUT|SELECT/.test(document.activeElement.tagName))
        dispatch(setwptSelection(id));
    },
    [dispatch],
  );
  const handleSetWptId = useCallback(
    (id) => dispatch(setwptId(id)),
    [dispatch],
  );
  const handleRemoveSpecialArea = useCallback(
    (id) => dispatch(removeSpecialArea(id)),
    [dispatch],
  );
  const handleRemoveWaypoint = useCallback(() => {
    if (wptSelection) {
      dispatch(removeWaypoint(wptSelection));
      dispatch(setwptSelection(null)); // Clear selection after deletion
    } else if (waypoints.length > 0) {
      // If no waypoint is selected, remove the last one
      dispatch(removeWaypoint(waypoints[waypoints.length - 1].id));
    }
  }, [dispatch, wptSelection, waypoints]);

  const handleRemoveLastSpecialArea = useCallback(() => {
    if (specialAreas.length > 0) {
      dispatch(removeSpecialArea(specialAreas[specialAreas.length - 1].id));
    }
  }, [dispatch, specialAreas]);

  const handleAddSpecialAreaRow = useCallback(() => {
    const payload = {
      id: uuidv4(),
      x: playerPosition?.x || 0,
      y: playerPosition?.y || 0,
      z: playerPosition?.z || 0,
    };
    dispatch(addSpecialArea(payload));
  }, [dispatch, playerPosition]);

  const handleAddSectionClick = useCallback(() => {
    const id = uuidv4();
    dispatch(addWaypointSection({ id, name: '' }));
    setEditingSectionId(id);
    setEditingSectionName('');
  }, [dispatch]);
  const handleRemoveSection = useCallback(
    (id) => {
      if (
        id !== 'default' &&
        window.confirm(`Remove section "${waypointSections[id].name}"?`)
      ) {
        dispatch(removeWaypointSection(id));
      }
      setContextMenu({ visible: false, x: 0, y: 0, sectionId: null });
    },
    [dispatch, waypointSections],
  );

  const handleRenameSection = useCallback((id, name) => {
    setEditingSectionId(id);
    setEditingSectionName(name);
    setContextMenu({ visible: false, x: 0, y: 0, sectionId: null });
  }, []);

  const handleSetCurrentSection = useCallback(
    (id) => {
      dispatch(setCurrentWaypointSection(id));
      setEditingSectionId(null);
      setViewMode('waypoints');
      setContextMenu({ visible: false, x: 0, y: 0, sectionId: null });
    },
    [dispatch],
  );

  const handleSectionRightClick = useCallback((e, id, name) => {
    e.preventDefault(); // Prevent the default browser context menu
    if (id !== 'default') {
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        sectionId: id,
      });
    }
  }, []);
  const handleSectionNameChange = (e) => setEditingSectionName(e.target.value);
  const handleSectionNameKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
  };
  const handleSectionNameBlur = useCallback(() => {
    if (editingSectionId) {
      const trimmedName = editingSectionName.trim();
      const originalSection = waypointSections[editingSectionId];

      if (trimmedName) {
        dispatch(
          renameWaypointSection({ id: editingSectionId, name: trimmedName }),
        );
      } else {
        // If the name is empty
        if (
          originalSection &&
          originalSection.waypoints &&
          originalSection.waypoints.length > 0
        ) {
          // If it's an existing section with waypoints, revert to its original name
          dispatch(
            renameWaypointSection({
              id: editingSectionId,
              name: originalSection.name,
            }),
          );
        } else if (editingSectionId !== 'default') {
          // If it's a new empty section or an empty existing section, delete it (if not default)
          dispatch(removeWaypointSection(editingSectionId));
        } else {
          // If it's the default section and left empty, revert to 'Default'
          dispatch(renameWaypointSection({ id: 'default', name: 'Default' }));
        }
      }
      setEditingSectionId(null);
    }
  }, [dispatch, editingSectionId, editingSectionName, waypointSections]);
  useEffect(() => {
    if (editingSectionId && sectionInputRef.current) {
      sectionInputRef.current.focus();
      sectionInputRef.current.select();
    }
  }, [editingSectionId]);

  const handleOpenModal = useCallback(
    (waypoint) => setModalState({ isOpen: true, waypoint }),
    [],
  );
  const handleCloseModal = () =>
    setModalState({ isOpen: false, waypoint: null });

  // --- MODIFICATION: This is the most critical fix. Save to 'script' property. ---
  const handleSaveModal = useCallback(
    (code) => {
      if (modalState.waypoint) {
        updateWaypointData(modalState.waypoint.id, { script: code });
      }
      handleCloseModal();
    },
    [modalState.waypoint, updateWaypointData],
  );
  // --- END MODIFICATION ---

  const data = useMemo(
    () => (viewMode === 'waypoints' ? waypoints : specialAreas),
    [viewMode, waypoints, specialAreas],
  );

  // --- MODIFICATION: Update the column definition to use 'script' ---
  const waypointCols = useMemo(
    () => [
      { Header: '#', accessor: (r, i) => i + 1, id: 'displayId', width: 40 },
      {
        Header: 'Type',
        accessor: 'type',
        width: 90,
        Cell: EditableSelectCell,
        options: [
          'Node',
          'Walk',
          'Stand',
          'Shovel',
          'Rope',
          'Machete',
          'Ladder',
          'Script',
        ],
      },
      {
        Header: 'Label',
        accessor: 'label',
        width: 80,
        Cell: EditableStringCell,
      },
      {
        Header: 'Coordinates',
        accessor: 'x',
        width: 140,
        Cell: EditableCoordinatesCell,
      },
      {
        Header: 'Range',
        accessor: 'range',
        width: 60,
        Cell: EditableNumberCell,
      },
      { Header: 'Script', accessor: 'script', width: 280, Cell: LuaScriptCell }, // Header, accessor, and Cell updated
    ],
    [],
  );
  // --- END MODIFICATION ---

  const specialAreaCols = useMemo(
    () => [
      {
        Header: 'On',
        accessor: 'enabled',
        width: 40,
        Cell: EditableCheckboxCell,
      },
      {
        Header: 'Hollow',
        accessor: 'hollow',
        width: 60,
        Cell: EditableCheckboxCell,
      },
      {
        Header: 'Ignore Lure',
        accessor: 'ignoreWhenLuring',
        width: 90,
        Cell: EditableCheckboxCell,
      },
      {
        Header: 'Name',
        accessor: 'name',
        width: 120,
        Cell: EditableStringCell,
      },
      {
        Header: 'Type',
        accessor: 'type',
        width: 90,
        Cell: EditableSelectCell,
        options: ['cavebot', 'targeting'],
      },
      {
        Header: 'Coordinates',
        accessor: 'x',
        width: 140,
        Cell: EditableCoordinatesCell,
      },
      { Header: 'W', accessor: 'sizeX', width: 50, Cell: EditableNumberCell },
      { Header: 'H', accessor: 'sizeY', width: 50, Cell: EditableNumberCell },
      {
        Header: 'Avoidance',
        accessor: 'avoidance',
        width: 80,
        Cell: EditableNumberCell,
      },
      { Header: '', id: 'actions', width: 50, Cell: ActionCell },
    ],
    [],
  );

  const columns = useMemo(
    () => (viewMode === 'waypoints' ? waypointCols : specialAreaCols),
    [viewMode, waypointCols, specialAreaCols],
  );
  const tableUpdateFn =
    viewMode === 'waypoints' ? updateWaypointData : updateSpecialAreaData;

  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } =
    useTable(
      {
        columns,
        data,
        updateMyData: tableUpdateFn,
        onEditAction: handleOpenModal,
        onRemove: handleRemoveSpecialArea,
      },
      useBlockLayout,
      useResizeColumns,
    );

  return (
    <DndProvider backend={HTML5Backend}>
      <StyledWaypointTable>
        <SectionManagementRow>
          <ModeSwitchButton
            active={viewMode === 'specialAreas'}
            onClick={() =>
              setViewMode((v) =>
                v === 'waypoints' ? 'specialAreas' : 'waypoints',
              )
            }
            title="Toggle Special Areas / Waypoints"
          >
            <Sliders size={16} />
          </ModeSwitchButton>
          {viewMode === 'waypoints' && (
            <SectionButtonsContainer>
              {Object.entries(waypointSections).map(([id, section]) => (
                <React.Fragment key={id}>
                  {editingSectionId === id ? (
                    <SectionNameInput
                      ref={sectionInputRef}
                      value={editingSectionName}
                      onChange={handleSectionNameChange}
                      onBlur={handleSectionNameBlur}
                      onKeyDown={handleSectionNameKeyDown}
                      style={{
                        width: `${Math.max(50, editingSectionName.length * 8 + 20)}px`,
                      }}
                    />
                  ) : (
                    <SectionButton
                      active={id === currentSectionId}
                      onClick={() => handleSetCurrentSection(id)}
                      onContextMenu={(e) =>
                        handleSectionRightClick(e, id, section.name)
                      }
                      onDoubleClick={() =>
                        handleRenameSection(id, section.name)
                      }
                      title={
                        id === 'default'
                          ? 'Default section'
                          : 'Double-click to rename, Right-click for options'
                      }
                    >
                      {section.name}
                    </SectionButton>
                  )}
                </React.Fragment>
              ))}
            </SectionButtonsContainer>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
            {viewMode === 'waypoints' ? (
              <RemoveSectionButton
                onClick={handleRemoveWaypoint}
                disabled={waypoints.length === 0 && !wptSelection}
              >
                <Trash2 size={16} />
              </RemoveSectionButton>
            ) : (
              <RemoveSectionButton
                onClick={handleRemoveLastSpecialArea}
                disabled={specialAreas.length === 0}
              >
                <Trash2 size={16} />
              </RemoveSectionButton>
            )}
            <AddSectionButton
              onClick={
                viewMode === 'waypoints'
                  ? handleAddSectionClick
                  : handleAddSpecialAreaRow
              }
              disabled={
                viewMode === 'waypoints' &&
                waypointCount >= MAX_WAYPOINTS_PER_SECTION
              }
            >
              <Plus size={16} />
            </AddSectionButton>
          </div>
        </SectionManagementRow>
        {contextMenu.visible && contextMenu.sectionId && (
          <div
            style={{
              position: 'absolute',
              top: contextMenu.y,
              left: contextMenu.x,
              backgroundColor: '#333',
              border: '1px solid #555',
              borderRadius: '4px',
              zIndex: 1000,
              padding: '5px 0',
              display: 'flex',
              flexDirection: 'column',
            }}
            onMouseLeave={() =>
              setContextMenu({ visible: false, x: 0, y: 0, sectionId: null })
            }
          >
            <button
              onClick={() =>
                handleRenameSection(
                  contextMenu.sectionId,
                  waypointSections[contextMenu.sectionId].name,
                )
              }
              style={{
                background: 'none',
                border: 'none',
                color: 'white',
                padding: '8px 12px',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              Rename
            </button>
            <button
              onClick={() => handleRemoveSection(contextMenu.sectionId)}
              style={{
                background: 'none',
                border: 'none',
                color: 'white',
                padding: '8px 12px',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
          </div>
        )}
        <div {...getTableProps()} className="table">
          <div className="thead">
            {headerGroups.map((hG) => (
              <div {...hG.getHeaderGroupProps()} className="tr header-group">
                {hG.headers.map((col) => (
                  <div {...col.getHeaderProps()} className="th">
                    {col.render('Header')}
                    {col.canResize && (
                      <div
                        {...col.getResizerProps()}
                        className={`resizer ${col.isResizing ? 'isResizing' : ''}`}
                      />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div {...getTableBodyProps()} className="tbody">
            {rows.map((row, i) => {
              prepareRow(row);
              return (
                <DraggableRow
                  key={row.original.id}
                  index={i}
                  row={row}
                  onSelect={
                    viewMode === 'waypoints' ? handleSelectRow : () => {}
                  }
                  onMoveRow={viewMode === 'waypoints' ? handleMoveRow : null}
                  onContextMenu={
                    viewMode === 'waypoints' ? handleSetWptId : null
                  }
                  isSelected={
                    viewMode === 'waypoints' && wptSelection === row.original.id
                  }
                  isActive={
                    viewMode === 'waypoints' && wptId === row.original.id
                  }
                  setRef={(node) => {
                    const map = rowRefs.current;
                    const id = row.original.id;
                    if (node) map.set(id, node);
                    else map.delete(id);
                  }}
                >
                  {row.cells.map((cell) => (
                    <div {...cell.getCellProps()} className="td">
                      {cell.render('Cell')}
                    </div>
                  ))}
                </DraggableRow>
              );
            })}
          </div>
        </div>
        <LuaEditorModal
          isOpen={modalState.isOpen}
          initialValue={modalState.waypoint?.script || ''}
          onClose={handleCloseModal}
          onSave={handleSaveModal}
        />
      </StyledWaypointTable>
    </DndProvider>
  );
};

export default WaypointTable;
