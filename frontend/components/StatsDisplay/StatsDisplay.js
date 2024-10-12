import React from 'react';

const StatsDisplay = () => {
  return (
    <div className="flex flex-col items-center justify-center w-64 h-24 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 space-y-2">
      <div className="w-full">
        <div className="flex justify-between items-center">
          <span className="font-semibold text-sm">Health</span>
          <span className="font-semibold text-sm">75%</span>
        </div>
        <div className="h-2 w-full bg-red-200 rounded-full">
          <div className="h-full bg-red-600 rounded-full w-3/4" />
        </div>
      </div>
      <div className="w-full">
        <div className="flex justify-between items-center">
          <span className="font-semibold text-sm">Mana</span>
          <span className="font-semibold text-sm">50%</span>
        </div>
        <div className="h-2 w-full bg-blue-200 rounded-full">
          <div className="h-full bg-blue-600 rounded-full w-1/2" />
        </div>
      </div>
    </div>
  );
};

export default StatsDisplay;
