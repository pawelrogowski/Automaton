import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
} from '../../redux/slices/cavebotSlice.js';
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
import MonacoEditorModal from './MonacoEditorModal.js';

// --- Reusable Row Component ---
const DraggableRow = React.memo(({ index, row, children, isSelected, isActive, onSelect, onMoveRow, setRef, onContextMenu }) => {
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
});

// --- Cell Components ---
const EditableStringCell = React.memo(({ value: initialValue, row: { original }, column: { id }, updateMyData }) => {
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
    <div onDoubleClick={() => setIsEditing(true)} style={{ width: '100%', height: '100%' }}>
      {value || <span> </span>}
    </div>
  );
});
const EditableSelectCell = React.memo(({ value: initialValue, row: { original }, column: { id, options }, updateMyData }) => {
  const [isEditing, setIsEditing] = useState(false);
  const onChange = (e) => {
    updateMyData(original.id, { [id]: e.target.value });
    setIsEditing(false);
  };
  if (isEditing)
    return (
      <select value={initialValue} onChange={onChange} onBlur={() => setIsEditing(false)} autoFocus onClick={(e) => e.stopPropagation()}>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  return (
    <div onDoubleClick={() => setIsEditing(true)} style={{ width: '100%', height: '100%' }}>
      {initialValue}
    </div>
  );
});
const EditableNumberCell = React.memo(({ value: initialValue, row: { original }, column: { id }, updateMyData }) => {
  const [value, setValue] = useState(initialValue);
  const [isEditing, setIsEditing] = useState(false);
  const onBlur = () => {
    setIsEditing(false);
    const p = parseInt(value, 10);
    if (!isNaN(p) && p !== initialValue) updateMyData(original.id, { [id]: p });
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
    <div onDoubleClick={() => setIsEditing(true)} style={{ width: '100%', height: '100%' }}>
      {initialValue}
    </div>
  );
});
const EditableCoordinatesCell = React.memo(({ row: { original }, updateMyData }) => {
  const [coords, setCoords] = useState({ x: original.x, y: original.y, z: original.z });
  const [isEditing, setIsEditing] = useState(false);
  const onChange = (e, coord) => setCoords((prev) => ({ ...prev, [coord]: e.target.value }));
  const onBlurContainer = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsEditing(false);
    const u = { x: parseInt(coords.x, 10) || 0, y: parseInt(coords.y, 10) || 0, z: parseInt(coords.z, 10) || 0 };
    if (u.x !== original.x || u.y !== original.y || u.z !== original.z) updateMyData(original.id, u);
  };
  useEffect(() => {
    setCoords({ x: original.x, y: original.y, z: original.z });
  }, [original.x, original.y, original.z]);
  if (isEditing)
    return (
      <div onBlur={onBlurContainer} className="coord-editor" onClick={(e) => e.stopPropagation()}>
        <input type="number" value={coords.x} onChange={(e) => onChange(e, 'x')} autoFocus />
        <input type="number" value={coords.y} onChange={(e) => onChange(e, 'y')} />
        <input type="number" value={coords.z} onChange={(e) => onChange(e, 'z')} />
      </div>
    );
  return (
    <div
      onDoubleClick={() => setIsEditing(true)}
      style={{ width: '100%', height: '100%' }}
    >{`${original.x}, ${original.y}, ${original.z}`}</div>
  );
});
const MonacoActionCell = React.memo(({ value, row: { original }, onEditAction }) => (
  <div onDoubleClick={() => onEditAction(original)} style={{ width: '100%', height: '100%', cursor: 'pointer' }}>
    {value ? (
      <pre style={{ margin: 0, padding: '2px', whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</pre>
    ) : (
      <span></span>
    )}
  </div>
));
const EditableCheckboxCell = React.memo(({ value: initialValue, row: { original }, column: { id }, updateMyData }) => (
  <input
    type="checkbox"
    checked={!!initialValue}
    onChange={(e) => updateMyData(original.id, { [id]: e.target.checked })}
    onClick={(e) => e.stopPropagation()}
    style={{ display: 'block', margin: 'auto' }}
  />
));
const ActionCell = React.memo(({ row: { original }, onRemove }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
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

// --- The Main Table Component ---
const WaypointTable = () => {
  const dispatch = useDispatch();
  const [viewMode, setViewMode] = useState('waypoints');
  const [modalState, setModalState] = useState({ isOpen: false, waypoint: null });
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [editingSectionName, setEditingSectionName] = useState('');

  const { waypointSections, currentSectionId, waypoints, wptSelection, wptId, specialAreas, playerPosition } = useSelector(
    (state) => ({
      waypointSections: state.cavebot.waypointSections,
      currentSectionId: state.cavebot.currentSection,
      waypoints: state.cavebot.waypointSections[state.cavebot.currentSection]?.waypoints || [],
      wptSelection: state.cavebot.wptSelection,
      wptId: state.cavebot.wptId,
      specialAreas: state.cavebot.specialAreas,
      // FIX: Get player position to use when creating new special areas
      playerPosition: state.gameState.playerMinimapPosition,
    }),
    shallowEqual,
  );

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
      throttle((dragIndex, hoverIndex) => dispatch(reorderWaypoints({ startIndex: dragIndex, endIndex: hoverIndex })), 100, {
        leading: true,
        trailing: false,
      }),
    [dispatch],
  );
  const handleMoveRow = useCallback((d, h) => throttledReorder(d, h), [throttledReorder]);
  const updateWaypointData = useCallback((id, u) => dispatch(updateWaypoint({ id, updates: u })), [dispatch]);
  const updateSpecialAreaData = useCallback((id, u) => dispatch(updateSpecialArea({ id, updates: u })), [dispatch]);
  const handleSelectRow = useCallback(
    (id) => {
      if (!/INPUT|SELECT/.test(document.activeElement.tagName)) dispatch(setwptSelection(id));
    },
    [dispatch],
  );
  const handleSetWptId = useCallback((id) => dispatch(setwptId(id)), [dispatch]);
  const handleRemoveSpecialArea = useCallback((id) => dispatch(removeSpecialArea(id)), [dispatch]);

  // FIX: Use player position when adding a new special area
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
  const handleRemoveCurrentSection = useCallback(() => {
    if (currentSectionId !== 'default' && window.confirm(`Remove section "${waypointSections[currentSectionId].name}"?`))
      dispatch(removeWaypointSection(currentSectionId));
  }, [dispatch, currentSectionId, waypointSections]);
  const handleSetCurrentSection = useCallback(
    (id) => {
      dispatch(setCurrentWaypointSection(id));
      setEditingSectionId(null);
      setViewMode('waypoints');
    },
    [dispatch],
  );
  const handleRenameSectionDoubleClick = useCallback((id, name) => {
    setEditingSectionId(id);
    setEditingSectionName(name);
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
      if (trimmedName) dispatch(renameWaypointSection({ id: editingSectionId, name: trimmedName }));
      else if (editingSectionId !== 'default') dispatch(removeWaypointSection(editingSectionId));
      else dispatch(renameWaypointSection({ id: 'default', name: 'Default' }));
      setEditingSectionId(null);
    }
  }, [dispatch, editingSectionId, editingSectionName]);
  useEffect(() => {
    if (editingSectionId && sectionInputRef.current) {
      sectionInputRef.current.focus();
      sectionInputRef.current.select();
    }
  }, [editingSectionId]);

  const handleOpenModal = useCallback((waypoint) => setModalState({ isOpen: true, waypoint }), []);
  const handleCloseModal = () => setModalState({ isOpen: false, waypoint: null });
  const handleSaveModal = useCallback(
    (code) => {
      if (modalState.waypoint) updateWaypointData(modalState.waypoint.id, { action: code });
      handleCloseModal();
    },
    [modalState.waypoint, updateWaypointData],
  );

  const data = useMemo(() => (viewMode === 'waypoints' ? waypoints : specialAreas), [viewMode, waypoints, specialAreas]);

  const waypointCols = useMemo(
    () => [
      { Header: '#', accessor: (r, i) => i + 1, id: 'displayId', width: 39 },
      {
        Header: 'Type',
        accessor: 'type',
        width: 80,
        Cell: EditableSelectCell,
        options: ['Node', 'Stand', 'Shovel', 'Rope', 'Machete', 'Ladder', 'Use', 'Action', 'Lure', 'Attack'],
      },
      { Header: 'Label', accessor: 'label', width: 75, Cell: EditableStringCell },
      { Header: 'Coordinates', accessor: 'x', width: 134, Cell: EditableCoordinatesCell },
      { Header: 'Range', accessor: 'range', width: 51, Cell: EditableNumberCell },
      { Header: 'Action', accessor: 'action', width: 275, Cell: MonacoActionCell },
    ],
    [],
  );

  // FIX: Split Size column into Width and Height
  const specialAreaCols = useMemo(
    () => [
      { Header: 'On', accessor: 'enabled', width: 35, Cell: EditableCheckboxCell },
      { Header: 'Name', accessor: 'name', width: 100, Cell: EditableStringCell },
      { Header: 'Type', accessor: 'type', width: 80, Cell: EditableSelectCell, options: ['cavebot', 'targeting'] },
      { Header: 'Coordinates', accessor: 'x', width: 134, Cell: EditableCoordinatesCell },
      { Header: 'W', accessor: 'sizeX', width: 45, Cell: EditableNumberCell }, // New Width column
      { Header: 'H', accessor: 'sizeY', width: 45, Cell: EditableNumberCell }, // New Height column
      { Header: 'Avoidance', accessor: 'avoidance', width: 70, Cell: EditableNumberCell },
      { Header: '', id: 'actions', width: 45, Cell: ActionCell },
    ],
    [],
  );

  const columns = useMemo(() => (viewMode === 'waypoints' ? waypointCols : specialAreaCols), [viewMode, waypointCols, specialAreaCols]);
  const tableUpdateFn = viewMode === 'waypoints' ? updateWaypointData : updateSpecialAreaData;

  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } = useTable(
    { columns, data, updateMyData: tableUpdateFn, onEditAction: handleOpenModal, onRemove: handleRemoveSpecialArea },
    useBlockLayout,
    useResizeColumns,
  );

  return (
    <DndProvider backend={HTML5Backend}>
      <StyledWaypointTable>
        <SectionManagementRow>
          <ModeSwitchButton
            active={viewMode === 'specialAreas'}
            onClick={() => setViewMode((v) => (v === 'waypoints' ? 'specialAreas' : 'waypoints'))}
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
                      style={{ width: `${Math.max(50, editingSectionName.length * 8 + 20)}px` }}
                    />
                  ) : (
                    <SectionButton
                      active={id === currentSectionId}
                      onClick={() => handleSetCurrentSection(id)}
                      onDoubleClick={() => handleRenameSectionDoubleClick(id, section.name)}
                      title={id === 'default' ? 'Default section' : 'Double-click to rename'}
                    >
                      {section.name}
                    </SectionButton>
                  )}
                </React.Fragment>
              ))}
            </SectionButtonsContainer>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
            {viewMode === 'waypoints' && (
              <RemoveSectionButton onClick={handleRemoveCurrentSection} disabled={currentSectionId === 'default'}>
                <Trash2 size={16} />
              </RemoveSectionButton>
            )}
            <AddSectionButton onClick={viewMode === 'waypoints' ? handleAddSectionClick : handleAddSpecialAreaRow}>
              <Plus size={16} />
            </AddSectionButton>
          </div>
        </SectionManagementRow>
        <div {...getTableProps()} className="table">
          <div className="thead">
            {headerGroups.map((hG) => (
              <div {...hG.getHeaderGroupProps()} className="tr header-group">
                {hG.headers.map((col) => (
                  <div {...col.getHeaderProps()} className="th">
                    {col.render('Header')}
                    {col.canResize && <div {...col.getResizerProps()} className={`resizer ${col.isResizing ? 'isResizing' : ''}`} />}
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
                  onSelect={viewMode === 'waypoints' ? handleSelectRow : () => {}}
                  onMoveRow={viewMode === 'waypoints' ? handleMoveRow : null}
                  onContextMenu={viewMode === 'waypoints' ? handleSetWptId : null}
                  isSelected={viewMode === 'waypoints' && wptSelection === row.original.id}
                  isActive={viewMode === 'waypoints' && wptId === row.original.id}
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
        <MonacoEditorModal
          isOpen={modalState.isOpen}
          initialValue={modalState.waypoint?.action || ''}
          onClose={handleCloseModal}
          onSave={handleSaveModal}
        />
      </StyledWaypointTable>
    </DndProvider>
  );
};

export default WaypointTable;
