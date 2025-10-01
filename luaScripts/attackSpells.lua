-- Configurable Spellcaster (per-spell player avoidance + combo scenarios)
-- Drop into persistent scripts

-- ===================== CONFIG =====================
local cfg = {
  safety = {
    requireOnline = true,
    respectTyping = true,
  },

  -- Fallback if a spell doesn't specify its own policy
  defaultPlayerPolicy = {
    -- "avoid"        -> only cast if paround() <= maxPlayers
    -- "recentAvoid"  -> also require secsSincePlayer() >= minSecsSince
    -- "always"       -> ignore players completely
    mode = "recentAvoid",
    maxPlayers = 0,
    minSecsSince = 10,
  },

  defaults = {
    castDelayMs = 250,
    allowMultiplePerLoop = false,
  },

  groups = {
    heavyOrcs      = { "Orc Berserker","Orc Leader","Orc Raider","Orc Warlord","Warlord Ruzad" },
    heavyOrcsPlus  = { "Orc Berserker","Orc Leader","Orc Raider","Orc Warlord","Warlord Ruzad","Orc","Orc Warrior","War Wolf","Cyclops" },
  },

  spells = {
    -- f9: exori ico — ignores players
    exori_ico = {
      key = "f9",
      spell = "exori ico",
      playerPolicy = { mode = "always" },
      defaults = { distance = 1, waitMs = 450 },
      scenarios = {
        -- 1) Always cast if target is Orc Warlord at distance 1
        { kind = "target", nameEquals = "Orc Warlord", maxDistance = 1 },

        -- 2) Or if at least 3 heavy orcs at distance 1
        { kind = "count", names = "heavyOrcs", threshold = 3, distance = 1 },
      },
    },

    -- f11: exori — avoid players recently seen
    exori = {
      key = "f11",
      spell = "exori",
      playerPolicy = { mode = "recentAvoid", maxPlayers = 0, minSecsSince = 10 },
      defaults = { distance = 1, waitMs = 450 },
      scenarios = {
        -- A) >= 4 heavy orcs within 1
        { kind = "count", names = "heavyOrcs",     threshold = 4, distance = 1 },

        -- B) >= 6 from heavyOrcsPlus within 1
        { kind = "count", names = "heavyOrcsPlus", threshold = 6, distance = 1 },

        -- C) Example “combo”: at least 1 Orc Warlord present AND total heavyOrcsPlus > X (set X below)
        --    Change total.threshold to your desired X and total.op to '>' or '>='.
        {
          kind = "combo",
          distance = 1,
          require = {
            { names = { "Orc Warlord" }, threshold = 1 }, -- guaranteed presence
          },
          total = {
            names = "heavyOrcsPlus",
            threshold = 3,   -- X: total must be > 5 if op is '>'
            op = ">",        -- comparison operators: '>=', '>', '<=', '<', '=='
          },
          -- Optional: exclude from total calculation
          -- exclude = { "Snake" },
        },
      },
    },
  },

  -- Priority: earlier entries checked first
  spellsOrder = {"exori", "exoriIco"},
}
-- =================== END CONFIG ===================

-- ================ Helpers =================
local unpack = table.unpack

local function resolveNames(ref)
  if type(ref) == "string" then
    return cfg.groups[ref] or {}
  elseif type(ref) == "table" then
    return ref
  end
  return {}
end

local function countWith(distance, include, exclude)
  local includes = resolveNames(include)
  local total = (#includes > 0) and caround(distance, unpack(includes)) or caround(distance)
  local excl = resolveNames(exclude)
  if #excl > 0 then
    total = total - caround(distance, unpack(excl))
  end
  if total < 0 then total = 0 end
  return total
end

local function compareCount(n, threshold, op)
  op = op or ">="
  if op == ">=" then return n >= threshold
  elseif op == ">" then return n > threshold
  elseif op == "<=" then return n <= threshold
  elseif op == "<" then return n < threshold
  elseif op == "==" then return n == threshold
  else return n >= threshold end
end

local function canCastWithPlayers(policy)
  policy = policy or cfg.defaultPlayerPolicy or { mode = "always" }
  local mode = policy.mode or "always"

  if mode == "always" then return true end

  local players = paround()
  if mode == "avoid" then
    return players <= (policy.maxPlayers or 0)
  elseif mode == "recentAvoid" then
    if players > (policy.maxPlayers or 0) then return false end
    return (secsSincePlayer() >= (policy.minSecsSince or 10))
  end
  return true
end

local function cast(spellDef)
  if not canUse(spellDef.spell) then return false end
  keyPress(spellDef.key)
  local waitMs = (spellDef.defaults and spellDef.defaults.waitMs) or cfg.defaults.castDelayMs
  wait(waitMs)
  return true
end

-- ============== Scenario evaluators ==============
local function scenario_count_ok(sc)
  local dist = sc.distance or 1
  local needed = sc.threshold or 1
  local n = countWith(dist, sc.names, sc.exclude)
  return compareCount(n, needed, sc.op)
end

local function scenario_target_ok(sc)
  if not $target then return false end
  if sc.nameEquals and ($target.name ~= sc.nameEquals) then return false end
  local d = $target.distance or 9999
  if sc.minDistance and d < sc.minDistance then return false end
  if sc.maxDistance and d > sc.maxDistance then return false end
  return true
end

-- Combo: require[] (every item must meet its threshold) AND total condition
-- sc = {
--   kind="combo", distance=1,
--   require = { { names=..., threshold=1, op=">=" }, { names=..., threshold=2 } },
--   total   = { names=..., threshold=5, op=">=" },
--   exclude = {...} -- optional, applied only to total
-- }
local function scenario_combo_ok(sc)
  local dist = sc.distance or 1
  -- All required clauses must pass
  if sc.require and #sc.require > 0 then
    for i = 1, #sc.require do
      local req = sc.require[i]
      local n = countWith(dist, req.names, req.exclude)
      local th = req.threshold or 1
      local op = req.op or ">="
      if not compareCount(n, th, op) then
        return false
      end
    end
  end
  -- Total condition (if provided)
  if sc.total then
    local tn = countWith(dist, sc.total.names, sc.exclude)
    local th = sc.total.threshold or 1
    local op = sc.total.op or ">="
    if not compareCount(tn, th, op) then
      return false
    end
  end
  return true
end

local function scenario_ok(sc)
  if sc.kind == "count" then
    return scenario_count_ok(sc)
  elseif sc.kind == "target" then
    return scenario_target_ok(sc)
  elseif sc.kind == "combo" then
    return scenario_combo_ok(sc)
  else
    return false
  end
end

-- ================ Guard rails =================
if cfg.safety.requireOnline and not $isOnline then return end
if cfg.safety.respectTyping and $isTyping then return end

-- ================ Main loop =================
for _, spellKey in ipairs(cfg.spellsOrder) do
  local spellDef = cfg.spells[spellKey]
  if spellDef and canCastWithPlayers(spellDef.playerPolicy) and canUse(spellDef.spell) then
    for i = 1, #(spellDef.scenarios or {}) do
      local sc = spellDef.scenarios[i]
      if scenario_ok(sc) then
        if cast(spellDef) and not cfg.defaults.allowMultiplePerLoop then
          return
        end
      end
    end
  end
end