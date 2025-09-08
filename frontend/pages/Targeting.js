import React, { useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useTable, useBlockLayout } from 'react-table';
import styled from 'styled-components';
import StyledTargeting from './Targeting.styled.js';
import TargetingTable from '../components/TargetingTable/TargetingTable.jsx';
import SelectControl from '../components/NodeRangeControl/SelectControl.jsx';
import { setUseBattleList } from '../redux/slices/targetingSlice.js';
import { StyledWaypointTable } from '../components/WaypointTable/WaypointTable.styled.js';

const TargetingContainer = styled.div`
  display: flex;
  width: 100%;
  gap: 10px;
  height: 100%;
`;

const MainColumn = styled.div`
  flex: 0 0 70%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0; /* Prevent overflow */
`;

const SideColumn = styled.div`
  flex: 0 0 30%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0; /* Prevent overflow */
`;

const CreatureList = () => {
  const { creatures } = useSelector((state) => state.targeting);

  const data = useMemo(() => creatures, [creatures]);

  const columns = useMemo(
    () => [
      {
        Header: 'Name',
        accessor: 'name',
        width: 150,
      },
      {
        Header: 'Health',
        accessor: 'healthTag',
        width: 80,
      },
      {
        Header: 'Dist',
        accessor: 'distance',
        width: 60,
      },
    ],
    [],
  );

  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } =
    useTable({ columns, data }, useBlockLayout);

  return (
    <StyledWaypointTable>
      <div {...getTableProps()} className="table">
        <div className="thead">
          {headerGroups.map((headerGroup) => (
            <div {...headerGroup.getHeaderGroupProps()} className="tr">
              {headerGroup.headers.map((column) => (
                <div {...column.getHeaderProps()} className="th">
                  {column.render('Header')}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div {...getTableBodyProps()} className="tbody">
          {rows.map((row) => {
            prepareRow(row);
            return (
              <div {...row.getRowProps()} className="tr">
                {row.cells.map((cell) => (
                  <div {...cell.getCellProps()} className="td">
                    {cell.render('Cell')}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </StyledWaypointTable>
  );
};

const Targeting = () => {
  const dispatch = useDispatch();
  const { target, useBattleList } = useSelector((state) => state.targeting);

  const handleUseBattleListChange = (value) => {
    dispatch(setUseBattleList(value));
  };

  return (
    <StyledTargeting>
      <TargetingContainer>
        <MainColumn>
          <div className="settings-container">
            <div className="setting-row">
              <SelectControl
                label="Use BattleList"
                value={useBattleList}
                onChange={handleUseBattleListChange}
                options={[
                  { value: true, label: 'Yes' },
                  { value: false, label: 'No' },
                ]}
              />
            </div>
          </div>
          <TargetingTable />
        </MainColumn>
        <SideColumn>
          <CreatureList />
        </SideColumn>
      </TargetingContainer>
    </StyledTargeting>
  );
};

export default Targeting;
