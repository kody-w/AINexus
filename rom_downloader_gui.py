import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import requests
import os
import threading
from urllib.parse import urlparse, unquote

class ROMDownloaderGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("ROM Downloader")
        self.root.geometry("600x400")
        self.root.resizable(True, True)
        
        # Variables
        self.download_thread = None
        self.is_downloading = False
        
        self.setup_gui()
        
        # Pre-fill the Pokemon SoulSilver URL
        self.url_entry.insert(0, "https://static.emulatorgames.net/roms/nintendo-ds/Pokemon%20SoulSilver%20(U)(Xenophobia).zip")
    
    def setup_gui(self):
        # Main frame
        main_frame = ttk.Frame(self.root, padding="20")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Configure grid weights
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(1, weight=1)
        
        # Title
        title_label = ttk.Label(main_frame, text="ROM Downloader", font=("Arial", 16, "bold"))
        title_label.grid(row=0, column=0, columnspan=3, pady=(0, 20))
        
        # URL input section
        ttk.Label(main_frame, text="ROM URL:").grid(row=1, column=0, sticky=tk.W, pady=5)
        self.url_entry = ttk.Entry(main_frame, width=50)
        self.url_entry.grid(row=1, column=1, sticky=(tk.W, tk.E), padx=(10, 5), pady=5)
        
        clear_btn = ttk.Button(main_frame, text="Clear", command=self.clear_url)
        clear_btn.grid(row=1, column=2, padx=(5, 0), pady=5)
        
        # Download location section
        ttk.Label(main_frame, text="Save to:").grid(row=2, column=0, sticky=tk.W, pady=5)
        self.location_var = tk.StringVar(value=os.path.expanduser("~/Downloads"))
        self.location_entry = ttk.Entry(main_frame, textvariable=self.location_var, width=50)
        self.location_entry.grid(row=2, column=1, sticky=(tk.W, tk.E), padx=(10, 5), pady=5)
        
        browse_btn = ttk.Button(main_frame, text="Browse", command=self.browse_location)
        browse_btn.grid(row=2, column=2, padx=(5, 0), pady=5)
        
        # Filename section
        ttk.Label(main_frame, text="Filename:").grid(row=3, column=0, sticky=tk.W, pady=5)
        self.filename_var = tk.StringVar()
        self.filename_entry = ttk.Entry(main_frame, textvariable=self.filename_var, width=50)
        self.filename_entry.grid(row=3, column=1, sticky=(tk.W, tk.E), padx=(10, 5), pady=5)
        
        auto_btn = ttk.Button(main_frame, text="Auto", command=self.auto_filename)
        auto_btn.grid(row=3, column=2, padx=(5, 0), pady=5)
        
        # Progress section
        progress_frame = ttk.LabelFrame(main_frame, text="Download Progress", padding="10")
        progress_frame.grid(row=4, column=0, columnspan=3, sticky=(tk.W, tk.E), pady=20)
        progress_frame.columnconfigure(0, weight=1)
        
        self.progress_var = tk.DoubleVar()
        self.progress_bar = ttk.Progressbar(progress_frame, variable=self.progress_var, maximum=100)
        self.progress_bar.grid(row=0, column=0, sticky=(tk.W, tk.E), pady=5)
        
        self.status_var = tk.StringVar(value="Ready to download")
        self.status_label = ttk.Label(progress_frame, textvariable=self.status_var)
        self.status_label.grid(row=1, column=0, pady=5)
        
        self.size_var = tk.StringVar()
        self.size_label = ttk.Label(progress_frame, textvariable=self.size_var)
        self.size_label.grid(row=2, column=0, pady=5)
        
        # Buttons section
        button_frame = ttk.Frame(main_frame)
        button_frame.grid(row=5, column=0, columnspan=3, pady=20)
        
        self.download_btn = ttk.Button(button_frame, text="Download", command=self.start_download)
        self.download_btn.pack(side=tk.LEFT, padx=(0, 10))
        
        self.cancel_btn = ttk.Button(button_frame, text="Cancel", command=self.cancel_download, state=tk.DISABLED)
        self.cancel_btn.pack(side=tk.LEFT, padx=(0, 10))
        
        self.open_folder_btn = ttk.Button(button_frame, text="Open Download Folder", command=self.open_download_folder)
        self.open_folder_btn.pack(side=tk.LEFT)
        
        # Instructions
        instructions = """
Instructions:
1. The ROM URL is already filled in for Pokemon SoulSilver
2. Choose where to save the file (Downloads folder is selected by default)
3. The filename will be set automatically, or you can customize it
4. Click 'Download' to start
5. Wait for the download to complete
6. Use 'Open Download Folder' to find your file
        """
        
        instructions_frame = ttk.LabelFrame(main_frame, text="How to Use", padding="10")
        instructions_frame.grid(row=6, column=0, columnspan=3, sticky=(tk.W, tk.E), pady=(20, 0))
        
        instructions_label = ttk.Label(instructions_frame, text=instructions, justify=tk.LEFT)
        instructions_label.pack()
    
    def clear_url(self):
        self.url_entry.delete(0, tk.END)
        self.filename_var.set("")
    
    def browse_location(self):
        folder = filedialog.askdirectory(initialdir=self.location_var.get())
        if folder:
            self.location_var.set(folder)
    
    def auto_filename(self):
        url = self.url_entry.get().strip()
        if url:
            try:
                parsed_url = urlparse(url)
                filename = unquote(os.path.basename(parsed_url.path))
                if filename:
                    self.filename_var.set(filename)
                else:
                    self.filename_var.set("downloaded_file.zip")
            except:
                self.filename_var.set("downloaded_file.zip")
    
    def open_download_folder(self):
        folder = self.location_var.get()
        if os.path.exists(folder):
            if os.name == 'nt':  # Windows
                os.startfile(folder)
            elif os.name == 'posix':  # macOS and Linux
                os.system(f'open "{folder}"' if os.uname().sysname == 'Darwin' else f'xdg-open "{folder}"')
    
    def start_download(self):
        url = self.url_entry.get().strip()
        location = self.location_var.get().strip()
        filename = self.filename_var.get().strip()
        
        # Validation
        if not url:
            messagebox.showerror("Error", "Please enter a ROM URL")
            return
        
        if not location:
            messagebox.showerror("Error", "Please select a download location")
            return
        
        if not filename:
            self.auto_filename()
            filename = self.filename_var.get().strip()
        
        if not os.path.exists(location):
            messagebox.showerror("Error", "Download location does not exist")
            return
        
        # Check if file already exists
        full_path = os.path.join(location, filename)
        if os.path.exists(full_path):
            if not messagebox.askyesno("File Exists", f"File '{filename}' already exists. Overwrite?"):
                return
        
        # Start download in separate thread
        self.is_downloading = True
        self.download_btn.config(state=tk.DISABLED)
        self.cancel_btn.config(state=tk.NORMAL)
        
        self.download_thread = threading.Thread(target=self.download_file, args=(url, full_path))
        self.download_thread.daemon = True
        self.download_thread.start()
    
    def cancel_download(self):
        self.is_downloading = False
        self.status_var.set("Download cancelled")
        self.download_btn.config(state=tk.NORMAL)
        self.cancel_btn.config(state=tk.DISABLED)
    
    def download_file(self, url, filepath):
        try:
            self.root.after(0, lambda: self.status_var.set("Connecting..."))
            
            response = requests.get(url, stream=True)
            response.raise_for_status()
            
            total_size = int(response.headers.get('content-length', 0))
            downloaded_size = 0
            chunk_size = 8192
            
            with open(filepath, 'wb') as file:
                for chunk in response.iter_content(chunk_size=chunk_size):
                    if not self.is_downloading:
                        break
                    
                    if chunk:
                        file.write(chunk)
                        downloaded_size += len(chunk)
                        
                        if total_size > 0:
                            progress = (downloaded_size / total_size) * 100
                            self.root.after(0, lambda p=progress: self.progress_var.set(p))
                            
                            size_text = f"{downloaded_size:,} / {total_size:,} bytes ({downloaded_size/1024/1024:.1f} MB / {total_size/1024/1024:.1f} MB)"
                            self.root.after(0, lambda s=size_text: self.size_var.set(s))
                            
                            status_text = f"Downloading... {progress:.1f}%"
                            self.root.after(0, lambda s=status_text: self.status_var.set(s))
            
            if self.is_downloading:
                self.root.after(0, lambda: self.download_complete(filepath, downloaded_size))
            else:
                # Clean up cancelled download
                if os.path.exists(filepath):
                    os.remove(filepath)
                    
        except Exception as e:
            self.root.after(0, lambda: self.download_error(str(e)))
    
    def download_complete(self, filepath, size):
        self.status_var.set("Download completed successfully!")
        self.size_var.set(f"Final size: {size:,} bytes ({size/1024/1024:.1f} MB)")
        self.progress_var.set(100)
        
        self.download_btn.config(state=tk.NORMAL)
        self.cancel_btn.config(state=tk.DISABLED)
        self.is_downloading = False
        
        messagebox.showinfo("Success", f"ROM downloaded successfully!\n\nSaved to: {filepath}")
    
    def download_error(self, error_msg):
        self.status_var.set(f"Error: {error_msg}")
        self.download_btn.config(state=tk.NORMAL)
        self.cancel_btn.config(state=tk.DISABLED)
        self.is_downloading = False
        
        messagebox.showerror("Download Error", f"Failed to download ROM:\n{error_msg}")

def main():
    root = tk.Tk()
    app = ROMDownloaderGUI(root)
    root.mainloop()

if __name__ == "__main__":
    main()