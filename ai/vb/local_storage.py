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
        self.current_guid = user_guid
        self.current_memory_path = "memory/" + user_guid
        return True
    def _file_path(self):
        if self.current_guid:
            return "memory/" + self.current_guid + "/user_memory.json"
        return "shared_memories/memory.json"
    def read_json(self, file_path=None):
        path = file_path or self._file_path()
        raw = localStorage.getItem(_PREFIX + path)
        if raw is None:
            return {}
        try:
            return json.loads(raw)
        except Exception:
            return {}
    def write_json(self, data, file_path=None):
        path = file_path or self._file_path()
        localStorage.setItem(_PREFIX + path, json.dumps(data, default=str))
        return True
    def read_file(self, file_path):
        return localStorage.getItem(_PREFIX + file_path)
    def write_file(self, file_path, content):
        localStorage.setItem(_PREFIX + file_path, content)
        return True
    def list_files(self, directory=""):
        prefix = _PREFIX + directory
        out = []
        n = localStorage.length
        for i in range(n):
            k = localStorage.key(i)
            if k and k.startswith(prefix):
                out.append(k[len(_PREFIX):])
        return out
    def delete_file(self, file_path):
        if localStorage.getItem(_PREFIX + file_path) is not None:
            localStorage.removeItem(_PREFIX + file_path)
            return True
        return False
    def file_exists(self, file_path):
        return localStorage.getItem(_PREFIX + file_path) is not None
