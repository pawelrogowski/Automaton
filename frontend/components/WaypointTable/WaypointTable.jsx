import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSelector, useDispatch, shallowEqual } from 'react-redux';
import { reorderWaypoints, setSelectedWaypointId, updateWaypoint } from '../../redux/slices/cavebotSlice.js';
import { useTable, useBlockLayout, useResizeColumns } from 'react-table';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useDrag, useDrop } from 'react-dnd';
import { throttle } from 'lodash';
import { StyledWaypointTable } from './WaypointTable.styled.js';
import MonacoEditorModal from './MonacoEditorModal.js';

// --- Reusable Draggable Row Component ---
const WaypointRow = React.memo(({ index, row, children, isSelected, onSelect, onMoveRow, setRef }) => {
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

  return (
    <div
      ref={combinedRef}
      style={{ opacity: isDragging ? 0.5 : 1 }}
      {...row.getRowProps()}
      className={`tr ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(row.original.id)}
    >
      {children}
    </div>
  );
});

// --- Specialized Editable Cell Components ---

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

  if (isEditing) {
    return (
      <select value={initialValue} onChange={onChange} onBlur={() => setIsEditing(false)} autoFocus onClick={(e) => e.stopPropagation()}>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
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
        <input type="number" value={coords.x} onChange={(e) => onChange(e, 'x')} autoFocus />
        <input type="number" value={coords.y} onChange={(e) => onChange(e, 'y')} />
        <input type="number" value={coords.z} onChange={(e) => onChange(e, 'z')} />
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
      {value ? (
        <pre style={{ margin: 0, padding: 0, whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</pre>
      ) : (
        <span></span>
      )}
    </div>
  );
});

// --- The Main Table Component ---
const WaypointTable = () => {
  const dispatch = useDispatch();

  const waypoints = useSelector((state) => state.cavebot.waypoints, shallowEqual);
  const selectedWaypointId = useSelector((state) => state.cavebot.selectedWaypointId);

  const [modalState, setModalState] = useState({ isOpen: false, waypoint: null });
  const rowRefs = useRef(new Map());

  useEffect(() => {
    const node = rowRefs.current.get(selectedWaypointId);
    if (node) {
      node.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedWaypointId]);

  const handleSelectRow = useCallback(
    (id) => {
      if (document.activeElement.tagName.toLowerCase() !== 'input' && document.activeElement.tagName.toLowerCase() !== 'select') {
        dispatch(setSelectedWaypointId(id));
      }
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

  const data = useMemo(() => waypoints, [waypoints]);

  const columns = useMemo(
    () => [
      { Header: 'ID', accessor: 'id', width: 39 },
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
                  isSelected={selectedWaypointId === row.original.id}
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
      </StyledWaypointTable>
      <MonacoEditorModal
        isOpen={modalState.isOpen}
        initialValue={modalState.waypoint?.action || ''}
        onClose={handleCloseModal}
        onSave={handleSaveModal}
      />
    </DndProvider>
  );
};

export default WaypointTable;
