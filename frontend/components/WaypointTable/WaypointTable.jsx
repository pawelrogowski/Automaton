import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Trash2, Plus } from 'react-feather';
import { useSelector, useDispatch, shallowEqual } from 'react-redux';
import { v4 as uuidv4 } from 'uuid'; // Import uuid for new section IDs
import {
  reorderWaypoints,
  setwptSelection,
  updateWaypoint,
  setwptId,
  addWaypointSection, // New action
  removeWaypointSection, // New action
  setCurrentWaypointSection, // New action
  renameWaypointSection, // New action
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
  SectionNameInput, // Import SectionNameInput
} from './WaypointTable.styled.js';
import MonacoEditorModal from './MonacoEditorModal.js';

// --- Reusable Draggable Row Component ---
// 2. ADD `isActive` and `onContextMenu` props
const WaypointRow = React.memo(({ index, row, children, isSelected, isActive, onSelect, onMoveRow, setRef, onContextMenu }) => {
  const [{ isDragging }, drag] = useDrag({
    type: 'row',
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: 'row',
    hover: (item) => {
      if (item.index === index) return;
      onMoveRow(item.index, index);
      item.index = index;
    },
  });

  const combinedRef = (node) => {
    setRef(node);
    drag(drop(node));
  };

  // Add the new `active-bot-wp` class if isActive is true
  const classNames = ['tr'];
  if (isSelected) classNames.push('selected');
  if (isActive) classNames.push('active-bot-wp');

  return (
    <div
      ref={combinedRef}
      style={{ opacity: isDragging ? 0.5 : 1 }}
      {...row.getRowProps()}
      className={classNames.join(' ')} // Use the new classNames
      onClick={() => onSelect(row.original.id)}
      // 3. ADD the onContextMenu handler to the row itself
      onContextMenu={(e) => {
        e.preventDefault(); // Prevent the default right-click menu
        onContextMenu(row.original.id); // Call our new handler
      }}
    >
      {children}
    </div>
  );
});

// --- Specialized Editable Cell Components (Unchanged) ---
const EditableStringCell = React.memo(({ value: initialValue, row: { original }, column: { id }, updateMyData }) => {
  const [value, setValue] = useState(initialValue);
  const [isEditing, setIsEditing] = useState(false);
  const onBlur = () => {
    setIsEditing(false);
    if (initialValue !== value) {
      updateMyData(original.id, { [id]: value });
    }
  };
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);
  if (isEditing) {
    return (
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onBlur();
        }}
        autoFocus
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <div onDoubleClick={() => setIsEditing(true)} style={{ width: '100%', height: '100%' }}>
      {' '}
      {value || <span> </span>}{' '}
    </div>
  );
});
const EditableSelectCell = React.memo(({ value: initialValue, row: { original }, column: { id, options }, updateMyData }) => {
  const [isEditing, setIsEditing] = useState(false);
  const onChange = (e) => {
    updateMyData(original.id, { [id]: e.target.value });
    setIsEditing(false);
  };
  if (isEditing) {
    return (
      <select value={initialValue} onChange={onChange} onBlur={() => setIsEditing(false)} autoFocus onClick={(e) => e.stopPropagation()}>
        {' '}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {' '}
            {opt}{' '}
          </option>
        ))}{' '}
      </select>
    );
  }
  return (
    <div onDoubleClick={() => setIsEditing(true)} style={{ width: '100%', height: '100%' }}>
      {' '}
      {initialValue}{' '}
    </div>
  );
});
const EditableNumberCell = React.memo(({ value: initialValue, row: { original }, column: { id }, updateMyData }) => {
  const [value, setValue] = useState(initialValue);
  const [isEditing, setIsEditing] = useState(false);
  const onBlur = () => {
    setIsEditing(false);
    const parsedValue = parseInt(value, 10);
    if (!isNaN(parsedValue) && parsedValue !== initialValue) {
      updateMyData(original.id, { [id]: parsedValue });
    } else {
      setValue(initialValue);
    }
  };
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);
  if (isEditing) {
    return (
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onBlur();
        }}
        autoFocus
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <div onDoubleClick={() => setIsEditing(true)} style={{ width: '100%', height: '100%' }}>
      {' '}
      {initialValue}{' '}
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
    const updates = { x: parseInt(coords.x, 10) || 0, y: parseInt(coords.y, 10) || 0, z: parseInt(coords.z, 10) || 0 };
    if (updates.x !== original.x || updates.y !== original.y || updates.z !== original.z) {
      updateMyData(original.id, updates);
    }
  };
  useEffect(() => {
    setCoords({ x: original.x, y: original.y, z: original.z });
  }, [original.x, original.y, original.z]);
  if (isEditing) {
    return (
      <div onBlur={onBlurContainer} className="coord-editor" onClick={(e) => e.stopPropagation()}>
        {' '}
        <input type="number" value={coords.x} onChange={(e) => onChange(e, 'x')} autoFocus />{' '}
        <input type="number" value={coords.y} onChange={(e) => onChange(e, 'y')} />{' '}
        <input type="number" value={coords.z} onChange={(e) => onChange(e, 'z')} />{' '}
      </div>
    );
  }
  return (
    <div
      onDoubleClick={() => setIsEditing(true)}
      style={{ width: '100%', height: '100%' }}
    >{`${original.x}, ${original.y}, ${original.z}`}</div>
  );
});
const ActionCell = React.memo(({ value, row: { original }, onEditAction }) => {
  return (
    <div onDoubleClick={() => onEditAction(original)} style={{ width: '100%', height: '100%', cursor: 'pointer' }}>
      {' '}
      {value ? (
        <pre style={{ margin: 0, padding: 0, whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</pre>
      ) : (
        <span></span>
      )}{' '}
    </div>
  );
});

// --- The Main Table Component ---
const WaypointTable = () => {
  const dispatch = useDispatch();

  const waypointSections = useSelector((state) => state.cavebot.waypointSections, shallowEqual);
  const currentSectionId = useSelector((state) => state.cavebot.currentSection);
  const waypoints = waypointSections[currentSectionId]?.waypoints || [];
  const wptSelection = useSelector((state) => state.cavebot.wptSelection);
  const wptId = useSelector((state) => state.cavebot.wptId);

  const [modalState, setModalState] = useState({ isOpen: false, waypoint: null });
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [editingSectionName, setEditingSectionName] = useState('');
  const sectionInputRef = useRef(null);
  const rowRefs = useRef(new Map());

  useEffect(() => {
    // Also scroll to the active `wptId`
    const idToScroll = wptSelection || wptId;
    const node = rowRefs.current.get(idToScroll);
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [wptSelection, wptId, currentSectionId]); // Add currentSectionId to dependency array

  const handleSelectRow = useCallback(
    (id) => {
      if (document.activeElement.tagName.toLowerCase() !== 'input' && document.activeElement.tagName.toLowerCase() !== 'select') {
        dispatch(setwptSelection(id));
      }
    },
    [dispatch],
  );

  // 5. CREATE the right-click handler
  const handleSetWptId = useCallback(
    (id) => {
      dispatch(setwptId(id));
    },
    [dispatch],
  );

  const throttledReorder = useMemo(
    () =>
      throttle(
        (dragIndex, hoverIndex) => {
          dispatch(reorderWaypoints({ startIndex: dragIndex, endIndex: hoverIndex }));
        },
        100,
        { leading: true, trailing: false },
      ),
    [dispatch],
  );
  const handleMoveRow = useCallback(
    (dragIndex, hoverIndex) => {
      throttledReorder(dragIndex, hoverIndex);
    },
    [throttledReorder],
  );
  const updateMyData = useCallback(
    (waypointId, updates) => {
      dispatch(updateWaypoint({ id: waypointId, updates }));
    },
    [dispatch],
  );
  const handleOpenModal = useCallback((waypoint) => setModalState({ isOpen: true, waypoint }), []);
  const handleCloseModal = () => setModalState({ isOpen: false, waypoint: null });
  const handleSaveModal = (newCode) => {
    if (modalState.waypoint) {
      updateMyData(modalState.waypoint.id, { action: newCode });
    }
    handleCloseModal();
  };

  const handleAddSectionClick = () => {
    const newId = uuidv4();
    dispatch(addWaypointSection({ id: newId, name: '' })); // Add with empty name to trigger inline edit
    setEditingSectionId(newId);
    setEditingSectionName('');
  };

  const handleRemoveCurrentSection = () => {
    if (currentSectionId === 'default') {
      // Use a more integrated notification system if available, for now, keep console.warn
      console.warn('Cannot remove the default section.');
      return;
    }
    // For now, keep window.confirm. This could be replaced by a custom modal later.
    if (window.confirm(`Are you sure you want to remove section "${waypointSections[currentSectionId].name}"?`)) {
      dispatch(removeWaypointSection(currentSectionId));
    }
  };

  const handleSetCurrentSection = (sectionId) => {
    dispatch(setCurrentWaypointSection(sectionId));
    setEditingSectionId(null); // Exit editing mode when changing sections
  };

  const handleRenameSectionDoubleClick = (sectionId, currentName) => {
    setEditingSectionId(sectionId);
    setEditingSectionName(currentName);
  };

  const handleSectionNameChange = (e) => {
    setEditingSectionName(e.target.value);
  };

  const handleSectionNameBlur = () => {
    if (editingSectionId) {
      const currentId = editingSectionId; // Capture current editing ID
      const currentName = editingSectionName; // Capture current editing name

      // Defer the state update to allow the native blur event to complete
      setTimeout(() => {
        const trimmedName = currentName.trim();
        if (trimmedName) {
          dispatch(renameWaypointSection({ id: currentId, name: trimmedName }));
        } else {
          // If name is empty, and it's not the default section, remove it.
          if (currentId !== 'default') {
            dispatch(removeWaypointSection(currentId));
          } else {
            // If it's the default section and the name is empty, revert to 'Default'
            dispatch(renameWaypointSection({ id: currentId, name: 'Default' }));
          }
        }
        setEditingSectionId(null); // Exit editing mode after dispatch
      }, 0);
    }
  };

  const handleSectionNameKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent default form submission
      e.target.blur(); // Programmatically trigger the onBlur event
    }
  };

  useEffect(() => {
    if (editingSectionId && sectionInputRef.current) {
      sectionInputRef.current.focus();
      // Select all text for easy renaming
      sectionInputRef.current.select();
    }
  }, [editingSectionId]);

  const data = useMemo(() => waypoints, [waypoints]);
  const columns = useMemo(
    () => [
      {
        Header: 'ID',
        accessor: (row, i) => i + 1, // Display the index + 1
        id: 'displayId', // Unique ID for this column
        width: 39,
      },
      {
        Header: 'Type',
        accessor: 'type',
        width: 80,
        Cell: EditableSelectCell,
        options: ['Node', 'Stand', 'Shovel', 'Rope', 'Machete', 'Ladder', 'Use', 'Action', 'Lure'],
      },
      { Header: 'Label', accessor: 'label', width: 75, Cell: EditableStringCell },
      { Header: 'Coordinates', accessor: 'x', width: 134, Cell: EditableCoordinatesCell },
      { Header: 'Range', accessor: 'range', width: 51, Cell: EditableNumberCell },
      { Header: 'Action', accessor: 'action', width: 275, Cell: ActionCell },
    ],
    [],
  );
  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } = useTable(
    { columns, data, updateMyData, onEditAction: handleOpenModal },
    useBlockLayout,
    useResizeColumns,
  );

  return (
    <DndProvider backend={HTML5Backend}>
      <StyledWaypointTable>
        <SectionManagementRow>
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
                    style={{ width: `${Math.max(50, editingSectionName.length * 8 + 20)}px` }} // Dynamic width
                  />
                ) : (
                  <SectionButton
                    active={id === currentSectionId}
                    onClick={() => handleSetCurrentSection(id)}
                    onDoubleClick={() => handleRenameSectionDoubleClick(id, section.name)}
                    title={id === 'default' ? 'Default section (cannot be removed)' : 'Double-click to rename'}
                  >
                    {section.name}
                  </SectionButton>
                )}
              </React.Fragment>
            ))}
          </SectionButtonsContainer>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
            <RemoveSectionButton onClick={handleRemoveCurrentSection} disabled={currentSectionId === 'default'}>
              <Trash2 size={16} />
            </RemoveSectionButton>
            <AddSectionButton onClick={handleAddSectionClick}>
              <Plus size={16} />
            </AddSectionButton>
          </div>
        </SectionManagementRow>
        <div {...getTableProps()} className="table">
          <div className="thead">
            {headerGroups.map((headerGroup) => (
              <div {...headerGroup.getHeaderGroupProps()} className="tr header-group">
                {headerGroup.headers.map((column) => (
                  <div {...column.getHeaderProps()} className="th">
                    {column.render('Header')}
                    {column.canResize && (
                      <div {...column.getResizerProps()} className={`resizer ${column.isResizing ? 'isResizing' : ''}`} />
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
                <WaypointRow
                  key={row.original.id}
                  index={i}
                  row={row}
                  onSelect={handleSelectRow}
                  onMoveRow={handleMoveRow}
                  // 6. PASS the props to the WaypointRow
                  onContextMenu={handleSetWptId}
                  isSelected={wptSelection === row.original.id}
                  isActive={wptId === row.original.id}
                  setRef={(node) => {
                    const map = rowRefs.current;
                    const id = row.original.id;
                    if (node) {
                      map.set(id, node);
                    } else {
                      map.delete(id);
                    }
                  }}
                >
                  {row.cells.map((cell) => (
                    <div {...cell.getCellProps()} className="td">
                      {cell.render('Cell')}
                    </div>
                  ))}
                </WaypointRow>
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
