// /home/feiron/Dokumenty/Automaton/frontend/components/TargetingTable/TargetingTable.jsx
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { Trash2, Plus } from 'react-feather';
import { useSelector, useDispatch, shallowEqual } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';
import {
  addCreatureToTargetingList,
  removeCreatureFromTargetingList,
  updateCreatureInTargetingList,
} from '../../redux/slices/targetingSlice.js';
import { useTable, useBlockLayout, useResizeColumns } from 'react-table';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useDrag, useDrop } from 'react-dnd';
import { throttle } from 'lodash';
import {
  StyledWaypointTable,
  SectionManagementRow,
  AddSectionButton,
} from '../WaypointTable/WaypointTable.styled.js';

// --- Reusable Cell Components ---

const DraggableRow = React.memo(
  ({ index, row, children, onSelect, onMoveRow, setRef, onContextMenu }) => {
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

    return (
      <div
        ref={combinedRef}
        style={{ opacity: isDragging ? 0.5 : 1 }}
        {...row.getRowProps()}
        className="tr"
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
        {value || <span>&nbsp;</span>}
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
    column: { id, min = 0, max = 100 },
    updateMyData,
  }) => {
    const [value, setValue] = useState(initialValue);
    const [isEditing, setIsEditing] = useState(false);
    const onBlur = () => {
      setIsEditing(false);
      let p = parseInt(value, 10);
      if (isNaN(p)) p = min;
      p = Math.max(min, Math.min(max, p)); // Clamp value
      if (p !== initialValue) {
        updateMyData(original.id, { [id]: p });
      }
      setValue(p); // Update local state to clamped value
    };
    useEffect(() => {
      setValue(initialValue);
    }, [initialValue]);
    if (isEditing)
      return (
        <input
          type="number"
          value={value || 0}
          min={min}
          max={max}
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

// --- Main Table Component ---

const TargetingTable = () => {
  const dispatch = useDispatch();
  const { targetingList } = useSelector(
    (state) => state.targeting,
    shallowEqual,
  );
  const [newCreatureName, setNewCreatureName] = useState('');

  const rowRefs = useRef(new Map());

  const throttledReorder = useMemo(
    () => throttle(() => {}, 100, { leading: true, trailing: false }),
    [],
  );

  const handleMoveRow = useCallback(
    (d, h) => throttledReorder(d, h),
    [throttledReorder],
  );

  const updateCreatureData = useCallback(
    (id, updates) => dispatch(updateCreatureInTargetingList({ id, updates })),
    [dispatch],
  );

  const handleRemoveCreature = useCallback(
    (id) => dispatch(removeCreatureFromTargetingList(id)),
    [dispatch],
  );

  const handleAddCreature = useCallback(() => {
    if (newCreatureName.trim()) {
      dispatch(
        addCreatureToTargetingList({
          id: uuidv4(),
          name: newCreatureName.trim(),
          stance: 'Reach',
          distance: 0,
          priority: 0,
          action: 'Attack',
          healthRange: 'Any',
          stickiness: 2, // Default stickiness
        }),
      );
      setNewCreatureName('');
    }
  }, [dispatch, newCreatureName]);

  const data = useMemo(() => targetingList, [targetingList]);

  const columns = useMemo(
    () => [
      {
        Header: 'Name',
        accessor: 'name',
        width: 100,
        Cell: EditableStringCell,
      },
      {
        Header: 'HP Range',
        accessor: 'healthRange',
        width: 70,
        Cell: EditableSelectCell,
        options: ['Any', 'Full', 'High', 'Medium', 'Low', 'Critical'],
      },
      {
        Header: 'Action',
        accessor: 'action',
        width: 60,
        Cell: EditableSelectCell,
        options: ['Attack', 'None'],
      },
      {
        Header: 'Stance',
        accessor: 'stance',
        width: 70,
        Cell: EditableSelectCell,
        options: ['Reach', 'Stand', 'Keep Away', 'Ignore'],
      },
      {
        Header: 'Distance',
        accessor: 'distance',
        width: 50,
        Cell: (props) => <EditableNumberCell {...props} min={0} max={7} />,
      },
      {
        Header: 'Priority',
        accessor: 'priority',
        width: 50,
        Cell: (props) => <EditableNumberCell {...props} min={0} max={20} />,
      },
      // --- NEW COLUMN: Stickiness ---
      {
        Header: 'Stick Strength',
        accessor: 'stickiness',
        width: 70,
        Cell: (props) => <EditableNumberCell {...props} min={0} max={10} />,
      },

      {
        Header: '',
        id: 'actions',
        width: 30,
        Cell: ({ row }) => (
          <ActionCell row={row} onRemove={handleRemoveCreature} />
        ),
      },
    ],
    [handleRemoveCreature],
  );

  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } =
    useTable(
      {
        columns,
        data,
        updateMyData: updateCreatureData,
      },
      useBlockLayout,
      useResizeColumns,
    );

  return (
    <DndProvider backend={HTML5Backend}>
      <StyledWaypointTable>
        <SectionManagementRow>
          <input
            type="text"
            value={newCreatureName}
            onChange={(e) => setNewCreatureName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddCreature();
            }}
            placeholder="Creature Name"
            style={{ flexGrow: 1, padding: '5px', marginRight: '5px' }}
          />
          <AddSectionButton onClick={handleAddCreature}>
            <Plus size={16} />
          </AddSectionButton>
        </SectionManagementRow>
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
                  onSelect={() => {}}
                  onMoveRow={handleMoveRow}
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
      </StyledWaypointTable>
    </DndProvider>
  );
};

export default TargetingTable;
