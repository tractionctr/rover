-- examples/love2d/game-bridge.lua
--
-- Drop this into a LÖVE2D game. It opens a WebSocket on the game's own
-- Lua state and runs code sent by the Rover IDE, exposing the game's API
-- as globals the player can call.
--
-- The player types Lua in Rover's editor; Rover sends it here; this file
-- runs it inside the game's real LuaJIT with the game's real functions.
--
-- Usage in your game:
--   require("game-bridge").start({ port = 37373, globals = { spawn = spawn, move = move } })
--
-- The `globals` table maps a global name to a game function. Each value is
-- called as fn(...) when the player's code calls that global.

local socket = require("socket")
local websocket = require("websocket")   -- https://github.com/arcapos/lua-websocket

local M = {}

function M.start(opts)
  opts = opts or {}
  local port = opts.port or 37373
  local globals = opts.globals or {}

  local server = websocket.server
  server:set_port(port)
  server:on("connection", function(ws)
    ws:send('{"type":"hello"}')

    ws:on("message", function(raw)
      local msg = decode_json(raw)
      if not msg or msg.type ~= "run" then return end

      local code = msg.payload and msg.payload.code or ""
      local fn, err = loadstring(code)
      local output, isError

      if not fn then
        output, isError = "Syntax error: " .. (err or ""), true
      else
        -- Expose the game's API as globals in this sandboxed chunk.
        local env = {}
        for name, fn in pairs(globals) do env[name] = fn end
        setmetatable(env, { __index = _G })
        setfenv(fn, env)

        local ok, result = pcall(fn)
        if not ok then
          output, isError = tostring(result), true
        else
          output, isError = tostring(result), false
        end
      end

      ws:send(encode_json({ type = "result", id = msg.id,
                            payload = { output = output, isError = isError } }))
    end)

    ws:on("close", function() end)
  end)

  print("[game-bridge] listening on ws://localhost:" .. port)
  return server
end

-- Minimal JSON helpers (replace with a real library if you have one).
local function decode_json(s)
  -- The lua-websocket library usually ships with cjson; fall back to a stub.
  if cjson then return cjson.decode(s) end
  return loadstring("return " .. s)()
end
local function encode_json(t)
  if cjson then return cjson.encode(t) end
    local parts = {}
    for k, v in pairs(t) do
      parts[#parts + 1] = tostring(k) .. "=" .. tostring(v)
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

return M