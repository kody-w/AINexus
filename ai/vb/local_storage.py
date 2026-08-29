"""utils/local_storage.py — Pyodide variant.
Drop-in for AzureFileStorageManager. Same API as the local brainstem's
rapp_brainstem/utils/local_storage.py — agents can't tell."""
import json
from js import localStorage

_PREFIX = "vbrainstem_storage:"

class AzureFileStorageManager:
    DEFAULT_MARKER_GUID = "c0p110t0-aaaa-bbbb-cccc-123456789abc"
    def __init__(self, share_name=None, **kwargs):
        self.current_guid = None
        self.shared_memory_path = "shared_memories"
        self.default_file_name = "memory.json"
        self.current_memory_path = self.shared_memory_path
    def set_memory_context(self, user_guid=None):
        if not user_guid or user_guid == self.DEFAULT_MARKER_GUID:
            self.current_guid = None
            self.current_memory_path = self.shared_memory_path
            return True
        # THE NAMESPACE IS BUILT OUT OF THE GUID, so the guid may not contain the separator that
        # builds it. A guid of "../someone-else" would name another player's namespace as this
        # player's own, and every scoping rule below would then be enforcing the wrong one.
        self.current_guid = str(user_guid).replace("\\", "/").replace("/", "_").strip(". ")
        if not self.current_guid:
            self.current_guid = None
            self.current_memory_path = self.shared_memory_path
            return True
        self.current_memory_path = "memory/" + self.current_guid
        return True
    def _file_path(self):
        if self.current_guid:
            return "memory/" + self.current_guid + "/user_memory.json"
        return "shared_memories/memory.json"
    def read_json(self, file_path=None):
        # A PATH THE CALLER CHOSE IS SCOPED LIKE ANY OTHER. These two were namespaced only when
        # they were given no path at all — pass one and they read and wrote raw, so
        # read_json("memory/<somebody-else>/user_memory.json") handed back another player's
        # memory word for word. The default path is already the player's own; anything else
        # goes through _scope, exactly like read_file.
        path = self._scope(file_path) if file_path else self._file_path()
        raw = localStorage.getItem(_PREFIX + path)
        if raw is None:
            return {}
        try:
            return json.loads(raw)
        except Exception:
            return {}
    def write_json(self, data, file_path=None):
        path = self._scope(file_path) if file_path else self._file_path()
        localStorage.setItem(_PREFIX + path, json.dumps(data, default=str))
        return True
    def _scope(self, file_path):
        """Every path belongs to whoever is asking.

        read_json/write_json were namespaced by user; these were not, so one runtime shared by
        several players had a set of paths they all wrote to and all read from — one player's
        notes arriving in another's hands. A path is scoped to the current memory context unless
        it deliberately names the shared space.

        AND THE KEY IS CHOSEN BY WHOEVER IS ASKING, which in this estate is a language model. A
        leading "/" used to mean "the whole store" and ".." walked out of the namespace a segment
        at a time, so a player could name another player's file and be handed it — the same leak
        this method was written to close, spelled differently. Neither can address anything now:
        the path is reduced to its real segments before it is scoped, and only the shared space
        can be named on purpose.
        """
        p = str(file_path or "").replace("\\", "/")
        parts = [seg for seg in p.split("/") if seg not in ("", ".", "..")]
        p = "/".join(parts)
        shared = self.shared_memory_path
        if p == shared or p.startswith(shared + "/"):
            return p                      # deliberately the shared space, and only exactly it
        base = self.current_memory_path
        if base and base != shared:
            if p == base or p.startswith(base + "/"):
                return p                  # already scoped: scoping it twice would move it
            return base.rstrip("/") + "/" + p if p else base
        # no identity: the shared space IS this caller's namespace, not the whole store
        return shared + "/" + p if p else shared

    def read_file(self, file_path):
        return localStorage.getItem(_PREFIX + self._scope(file_path))
    def write_file(self, file_path, content):
        localStorage.setItem(_PREFIX + self._scope(file_path), content)
        return True
    def list_files(self, directory=""):
        # a directory prefix, with its separator: "memory/ann" must not list "memory/annie"
        scoped = self._scope(directory)
        prefix = _PREFIX + scoped + ("" if scoped.endswith("/") else "/")
        out = []
        n = localStorage.length
        for i in range(n):
            k = localStorage.key(i)
            if k and k.startswith(prefix):
                out.append(k[len(_PREFIX):])
        return out
    def delete_file(self, file_path):
        key = _PREFIX + self._scope(file_path)
        if localStorage.getItem(key) is not None:
            localStorage.removeItem(key)
            return True
        return False
    def file_exists(self, file_path):
        return localStorage.getItem(_PREFIX + self._scope(file_path)) is not None
