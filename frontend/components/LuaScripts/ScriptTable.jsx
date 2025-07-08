import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Trash2, Plus, ChevronDown, ChevronRight } from 'react-feather';
import { useTable, useBlockLayout, useResizeColumns, useExpanded } from 'react-table';
import { StyledScriptTable, AddSectionButton } from './ScriptTable.styled.js';
import CustomSwitch from '../CustomSwitch/CustomSwitch.js'; // Import CustomSwitch

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

const ScriptCodeCell = React.memo(({ value, row: { original }, onEditScript }) => (
  <div onDoubleClick={() => onEditScript(original.id)} style={{ width: '100%', height: '100%', cursor: 'pointer' }}>
    {value ? (
      <pre style={{ margin: 0, padding: '2px', whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value.split('\n')[0]}
      </pre>
    ) : (
      <span></span>
    )}
  </div>
));

const ActionCell = React.memo(({ row: { original }, onRemove }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '5px' }}>
    {onRemove && (
      <Trash2
        size={16}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(original.id);
        }}
        style={{ cursor: 'pointer' }}
      />
    )}
  </div>
));

const LogToggleCell = React.memo(({ row, onClearLog }) => {
  const { original, toggleRowExpanded, isExpanded } = row;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '5px' }}>
      <button
        className="expand-button"
        onClick={(e) => {
          e.stopPropagation();
          toggleRowExpanded();
        }}
      >
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Log ({original.log ? original.log.length : 0})
      </button>
      {original.log && original.log.length > 0 && (
        <button
          className="expand-button"
          onClick={(e) => {
            e.stopPropagation();
            onClearLog(original.id);
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
});

const ScriptTable = ({
  scripts,
  updateScriptData,
  onEditScript,
  onRemoveScript,
  onToggleScriptEnabled,
  onClearScriptLog,
  onAddScript,
  type,
}) => {
  const data = useMemo(() => scripts, [scripts]);
  const [expanded, setExpanded] = useState({});

  const commonColumns = useMemo(
    () => [
      {
        Header: 'Name',
        accessor: 'name',
        width: 150,
        Cell: EditableStringCell,
      },
      {
        Header: 'Code',
        accessor: 'code',
        width: 250,
        Cell: (props) => <ScriptCodeCell {...props} onEditScript={onEditScript} />,
      },
      {
        Header: 'Log',
        id: 'logToggle',
        width: 120,
        Cell: (props) => <LogToggleCell {...props} onClearLog={onClearScriptLog} />,
      },
      {
        Header: 'Actions',
        id: 'actions',
        width: 70,
        Cell: (props) => <ActionCell {...props} onRemove={onRemoveScript} />,
      },
    ],
    [onEditScript, onRemoveScript, onClearScriptLog],
  );

  const persistentScriptColumns = useMemo(
    () => [
      {
        Header: 'Enabled',
        accessor: 'enabled',
        width: 70,
        Cell: ({ value: initialValue, row: { original } }) => (
          <CustomSwitch
            checked={!!initialValue}
            onChange={() => onToggleScriptEnabled(original.id)}
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'block', margin: 'auto' }}
          />
        ),
      },
      { Header: 'Min Loop', accessor: 'loopMin', width: 80, Cell: EditableNumberCell },
      { Header: 'Max Loop', accessor: 'loopMax', width: 80, Cell: EditableNumberCell },
      ...commonColumns,
    ],
    [onToggleScriptEnabled, commonColumns],
  );

  const hotkeyScriptColumns = useMemo(
    () => [{ Header: 'Hotkey', accessor: 'hotkey', width: 100, Cell: EditableStringCell }, ...commonColumns],
    [commonColumns],
  );

  const columns = useMemo(() => {
    if (type === 'persistent') return persistentScriptColumns;
    if (type === 'hotkey') return hotkeyScriptColumns;
    return [];
  }, [type, persistentScriptColumns, hotkeyScriptColumns]);

  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow, visibleColumns } = useTable(
    {
      columns,
      data,
      updateMyData: updateScriptData,
      onEditScript,
      onRemoveScript,
      onToggleScriptEnabled,
      onClearScriptLog,
      getSubRows: (row) => (row.isExpanded ? [{ id: `${row.id}-log`, isLogRow: true, log: row.original.log }] : []),
      state: { expanded },
      onExpandedChange: setExpanded,
    },
    useBlockLayout,
    useResizeColumns,
    useExpanded,
  );

  return (
    <StyledScriptTable>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '5px', borderBottom: '1px solid #555' }}>
        <AddSectionButton onClick={onAddScript}>
          <Plus size={16} /> New Script
        </AddSectionButton>
      </div>
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
          {rows.map((row) => {
            prepareRow(row);
            return (
              <React.Fragment key={row.id}>
                <div {...row.getRowProps()} className="tr">
                  {row.cells.map((cell) => (
                    <div {...cell.getCellProps()} className="td">
                      {cell.render('Cell')}
                    </div>
                  ))}
                </div>
                {row.isExpanded && row.original.log && row.original.log.length > 0 && (
                  <div className="tr">
                    <div
                      className="td"
                      style={{
                        width: `${visibleColumns.reduce((sum, col) => sum + col.width, 0)}px`,
                        gridColumn: `span ${visibleColumns.length}`,
                        padding: '0',
                      }}
                    >
                      <pre className="script-log-display">{row.original.log.join('\n')}</pre>
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </StyledScriptTable>
  );
};

export default ScriptTable;
