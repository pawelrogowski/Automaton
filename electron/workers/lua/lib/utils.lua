---
-- Checks if the current time falls within a server save "no-login" window.
-- The window is calculated based on a given server save time.
-- @param serverSaveTimeStr (string) The server save time in "HH:MM" format (e.g., "10:00").
-- @return (boolean) True if it's currently within the no-login window, false otherwise.
---
function isServerSaveTime(serverSaveTimeStr)
  -- --- Configuration ---
  local preSaveMinutes = 10  -- Block logins this many minutes BEFORE server save
  local postSaveMinutes = 5  -- Block logins this many minutes AFTER server save
  -----------------------

  -- Step 1: Parse the input string to get the server save hour and minute
  local ssHour, ssMinute = string.match(serverSaveTimeStr, "(%d+):(%d+)")

  if not ssHour or not ssMinute then
    print("Error: Invalid time format for server save. Please use 'HH:MM'.")
    return false -- Return false to be safe, allowing login attempts
  end

  ssHour = tonumber(ssHour)
  ssMinute = tonumber(ssMinute)

  -- Step 2: Convert all times to total minutes from midnight for easy comparison
  local now = os.date("*t")
  local currentTotalMinutes = now.hour * 60 + now.min
  local ssTotalMinutes = ssHour * 60 + ssMinute

  -- A day has 1440 minutes (24 * 60)
  local minutesInDay = 1440

  -- Step 3: Calculate the start and end of the window, handling midnight wraparound
  -- The modulo operator (%) is perfect for handling time that "wraps around" the clock
  local startWindow = (ssTotalMinutes - preSaveMinutes + minutesInDay) % minutesInDay
  local endWindow = (ssTotalMinutes + postSaveMinutes) % minutesInDay

  -- Step 4: Check if the current time is inside the window
  -- This logic correctly handles windows that cross midnight (e.g., start at 23:50, end at 00:05)
  if startWindow < endWindow then
    -- Standard case: The window is on the same day (e.g., 9:50 to 10:05)
    return currentTotalMinutes >= startWindow and currentTotalMinutes <= endWindow
  else
    -- Wraparound case: The window crosses midnight (e.g., 23:50 to 00:05)
    return currentTotalMinutes >= startWindow or currentTotalMinutes <= endWindow
  end
end