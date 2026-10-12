// Atelier launcher for Windows: a small tray app that starts Atelier without any console window,
// opens it in your default browser (or, if you opt in, a minimal app window), restarts it after an update,
// and stops everything it started when you choose Quit.
//
// Built by packaging/windows/build.ps1 with the C# compiler that ships with Windows (.NET Framework 4).
// Layout it expects next to itself: versions\<version>\{app,runtime}, and a "current" file naming the version.
// User data lives in %APPDATA%\Atelier-Preview (ATELIER_DATA_DIR overrides it, for tests).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Atelier")]
[assembly: AssemblyProduct("Atelier by ARCITECH (preview)")]
[assembly: AssemblyDescription("Atelier by ARCITECH - powered by DSH (DeepSeek Harness)")]
[assembly: AssemblyCompany("ARCITECH")]
[assembly: AssemblyCopyright("(c) 2026 ARCITECH. PolyForm Shield 1.0.0")]
[assembly: AssemblyVersion("0.1.0.0")]
[assembly: AssemblyFileVersion("0.1.0.0")]

namespace ARCITECH.Atelier
{
    static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
            public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)]
        public struct IO_COUNTERS
        {
            public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount;
            public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount;
        }
        [StructLayout(LayoutKind.Sequential)]
        public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
        }
        public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
        public const int JobObjectExtendedLimitInformation = 9;
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll")] public static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);
        [DllImport("kernel32.dll")] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
    }

    class Launcher : ApplicationContext
    {
        readonly string root, dataDir, logDir, runDir, urlFile, instanceKey;
        readonly bool noBrowser;
        readonly NotifyIcon tray;
        readonly SynchronizationContext ui;
        Process server;
        IntPtr job = IntPtr.Zero;
        StreamWriter log;
        readonly object logLock = new object();
        readonly Queue<string> tail = new Queue<string>();
        System.Windows.Forms.Timer readyTimer;
        DateTime startedAt;
        bool quitting, openWhenReady = true, setupWhenReady;
        EventWaitHandle openSignal, quitSignal;

        public Launcher(string root, string instanceKey, bool noBrowser, bool setup)
        {
            this.root = root; this.instanceKey = instanceKey; this.noBrowser = noBrowser; this.setupWhenReady = setup;
            ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            string custom = Environment.GetEnvironmentVariable("ATELIER_DATA_DIR");
            dataDir = !string.IsNullOrEmpty(custom) ? custom : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Atelier-Preview");
            logDir = Path.Combine(dataDir, "logs"); runDir = Path.Combine(dataDir, "run");
            Directory.CreateDirectory(logDir); Directory.CreateDirectory(runDir);
            urlFile = Path.Combine(runDir, "url.json");

            tray = new NotifyIcon();
            tray.Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
            tray.Text = "Atelier is starting...";
            var menu = new ContextMenuStrip();
            menu.Items.Add("Open Atelier", null, delegate { OpenApp(false); });
            menu.Items.Add("Set up model endpoint", null, delegate { OpenApp(true); });
            menu.Items.Add("Open logs folder", null, delegate { Process.Start("explorer.exe", "\"" + logDir + "\""); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit Atelier", null, delegate { Quit(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { OpenApp(false); };
            tray.Visible = true;

            openSignal = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\AtelierPreview-open-" + instanceKey);
            quitSignal = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\AtelierPreview-quit-" + instanceKey);
            var watcher = new Thread(WatchSignals); watcher.IsBackground = true; watcher.Start();
            StartServer();
        }

        void WatchSignals()
        {
            var handles = new WaitHandle[] { openSignal, quitSignal };
            while (true)
            {
                int which = WaitHandle.WaitAny(handles);
                if (which == 0) ui.Post(delegate { OpenApp(false); }, null);
                else { ui.Post(delegate { Quit(); }, null); return; }
            }
        }

        static string ReadText(string path)
        {
            try { var text = File.ReadAllText(path).Trim(); return text.Length > 0 ? text : null; } catch { return null; }
        }

        bool VersionUsable(string version)
        {
            return version != null && version.IndexOfAny(Path.GetInvalidFileNameChars()) < 0
                && File.Exists(Path.Combine(root, "versions", version, "app", "start-preview.mjs"))
                && File.Exists(Path.Combine(root, "versions", version, "runtime", "node.exe"));
        }

        // A staged update or a rollback becomes current when Atelier starts; the old current is kept as previous.
        string PromotePending()
        {
            string current = ReadText(Path.Combine(root, "current"));
            string pending = ReadText(Path.Combine(root, "pending"));
            if (pending != null)
            {
                if (VersionUsable(pending) && pending != current)
                {
                    if (current != null) File.WriteAllText(Path.Combine(root, "previous"), current);
                    File.WriteAllText(Path.Combine(root, "current"), pending);
                    Log("[launcher] switched from " + (current ?? "nothing") + " to " + pending);
                    current = pending;
                }
                try { File.Delete(Path.Combine(root, "pending")); } catch { }
            }
            if (!VersionUsable(current))
            {
                string previous = ReadText(Path.Combine(root, "previous"));
                if (VersionUsable(previous)) { Log("[launcher] version " + current + " is incomplete; using " + previous); current = previous; }
            }
            return current;
        }

        void OpenLog()
        {
            try
            {
                var old = new List<string>(Directory.GetFiles(logDir, "atelier-*.log"));
                old.Sort(); while (old.Count > 9) { try { File.Delete(old[0]); } catch { } old.RemoveAt(0); }
            }
            catch { }
            var stream = new FileStream(Path.Combine(logDir, "atelier-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".log"), FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
            log = new StreamWriter(stream, new UTF8Encoding(false)); log.AutoFlush = true;
        }

        void Log(string line)
        {
            if (line == null) return;
            lock (logLock)
            {
                if (log != null) log.WriteLine(line);
                tail.Enqueue(line); while (tail.Count > 12) tail.Dequeue();
            }
        }

        void StartServer()
        {
            if (log == null) OpenLog();
            string version = PromotePending();
            if (!VersionUsable(version))
            {
                MessageBox.Show("Atelier is not installed completely. Please run the installer again.\n\nFolder: " + root, "Atelier", MessageBoxButtons.OK, MessageBoxIcon.Error);
                ExitThread(); return;
            }
            string versionDir = Path.Combine(root, "versions", version);
            try { File.Delete(urlFile); } catch { }
            var info = new ProcessStartInfo(Path.Combine(versionDir, "runtime", "node.exe"),
                "\"" + Path.Combine(versionDir, "app", "start-preview.mjs") + "\" --url-file \"" + urlFile + "\"");
            info.WorkingDirectory = Path.Combine(versionDir, "app");
            info.UseShellExecute = false; info.CreateNoWindow = true;
            info.RedirectStandardOutput = true; info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8; info.StandardErrorEncoding = Encoding.UTF8;
            info.EnvironmentVariables["ATELIER_HOME"] = dataDir;
            info.EnvironmentVariables["ATELIER_INSTALL_ROOT"] = root;
            info.EnvironmentVariables["DSH_TELEMETRY_DISABLED"] = "1";
            Log("[launcher] starting Atelier " + version + " at " + DateTime.Now.ToString("s"));
            server = new Process(); server.StartInfo = info; server.EnableRaisingEvents = true;
            server.OutputDataReceived += delegate (object s, DataReceivedEventArgs e) { Log(e.Data); };
            server.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { Log(e.Data); };
            server.Exited += delegate { ui.Post(delegate { ServerExited(); }, null); };
            server.Start();
            AttachToJob(server);
            server.BeginOutputReadLine(); server.BeginErrorReadLine();
            startedAt = DateTime.Now;
            tray.Text = "Atelier is starting...";
            readyTimer = new System.Windows.Forms.Timer(); readyTimer.Interval = 500;
            readyTimer.Tick += delegate { CheckReady(); };
            readyTimer.Start();
        }

        // Everything Atelier starts (its web server, model bridges) belongs to one job, which closes with the launcher.
        void AttachToJob(Process process)
        {
            if (job == IntPtr.Zero)
            {
                job = Native.CreateJobObject(IntPtr.Zero, null);
                var limits = new Native.JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                limits.BasicLimitInformation.LimitFlags = Native.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                Native.SetInformationJobObject(job, Native.JobObjectExtendedLimitInformation, ref limits, (uint)Marshal.SizeOf(typeof(Native.JOBOBJECT_EXTENDED_LIMIT_INFORMATION)));
            }
            Native.AssignProcessToJobObject(job, process.Handle);
        }

        void CheckReady()
        {
            if (File.Exists(urlFile) && ReadText(urlFile) != null)
            {
                readyTimer.Stop();
                tray.Text = "Atelier is running";
                if (openWhenReady && !noBrowser) OpenApp(setupWhenReady || SetupNeeded());
                openWhenReady = true; setupWhenReady = false;
            }
            else if ((DateTime.Now - startedAt).TotalSeconds > 240)
            {
                readyTimer.Stop();
                tray.ShowBalloonTip(8000, "Atelier", "Atelier is taking unusually long to start. The log is in " + logDir, ToolTipIcon.Warning);
            }
        }

        bool SetupNeeded() { string text = ReadText(urlFile); return text != null && text.Contains("\"setupNeeded\":true"); }

        static string JsonField(string json, string name)
        {
            int at = json.IndexOf("\"" + name + "\":\""); if (at < 0) return null;
            int start = at + name.Length + 4; int end = json.IndexOf('"', start);
            return end > start ? json.Substring(start, end - start) : null;
        }

        void OpenApp(bool setup)
        {
            string text = ReadText(urlFile);
            if (text == null) { setupWhenReady = setup; tray.ShowBalloonTip(4000, "Atelier", "Atelier is still starting. It opens in a moment.", ToolTipIcon.Info); return; }
            string url = JsonField(text, setup ? "setupUrl" : "url");
            if (url == null || !(url.StartsWith("http://localhost:") || url.StartsWith("http://127.0.0.1:"))) return;
            if (noBrowser) return;
            string edge = FindEdge();
            // The default browser by default; "app" in window-mode.txt opts in to a minimal Edge app window.
            string mode = ReadText(Path.Combine(dataDir, "window-mode.txt")) ?? "browser";
            try
            {
                if (edge != null && mode == "app") Process.Start(new ProcessStartInfo(edge, "--app=\"" + url + "\"") { UseShellExecute = false });
                else Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        }

        static string FindEdge()
        {
            foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                using (var key = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
                {
                    var value = key == null ? null : key.GetValue(null) as string;
                    if (value != null && File.Exists(value)) return value;
                }
            }
            foreach (var dir in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) })
            {
                var path = Path.Combine(dir, @"Microsoft\Edge\Application\msedge.exe");
                if (File.Exists(path)) return path;
            }
            return null;
        }

        void ServerExited()
        {
            int code = 1; try { code = server.ExitCode; } catch { }
            Log("[launcher] Atelier exited with code " + code);
            if (readyTimer != null) readyTimer.Stop();
            try { File.Delete(urlFile); } catch { }
            if (quitting) return;
            if (code == 75) { Log("[launcher] restarting for an update or rollback"); StartServer(); return; }
            string last;
            lock (logLock) { last = string.Join("\n", tail.ToArray()); }
            tray.Visible = false;
            MessageBox.Show("Atelier stopped (code " + code + ").\n\n" + last + "\n\nThe full log is in " + logDir, "Atelier", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            Cleanup(); ExitThread();
        }

        void Quit()
        {
            if (quitting) return;
            quitting = true;
            Log("[launcher] quit requested");
            Cleanup();
            ExitThread();
        }

        void Cleanup()
        {
            tray.Visible = false;
            if (job != IntPtr.Zero) { Native.CloseHandle(job); job = IntPtr.Zero; }  // closes Atelier and everything it started
            try { if (server != null && !server.HasExited) server.Kill(); } catch { }
            try { File.Delete(urlFile); } catch { }
            lock (logLock) { if (log != null) { log.Dispose(); log = null; } }
        }

        [STAThread]
        static int Main(string[] args)
        {
            string root = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            bool quit = Array.IndexOf(args, "--quit") >= 0;
            bool setup = Array.IndexOf(args, "--setup") >= 0;
            bool noBrowser = Array.IndexOf(args, "--no-browser") >= 0 || Environment.GetEnvironmentVariable("ATELIER_NO_BROWSER") == "1";
            string key;
            using (var sha = SHA1.Create())
                key = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToLowerInvariant()))).Replace("-", "").Substring(0, 16);
            bool created;
            using (var mutex = new Mutex(true, "Local\\AtelierPreview-" + key, out created))
            {
                if (!created)
                {
                    // Atelier already runs: ask it to show itself (or to quit), then leave.
                    try { EventWaitHandle.OpenExisting("Local\\AtelierPreview-" + (quit ? "quit-" : "open-") + key).Set(); } catch { }
                    if (quit) { try { mutex.WaitOne(20000); mutex.ReleaseMutex(); } catch (AbandonedMutexException) { } }
                    return 0;
                }
                if (quit) return 0;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
                Application.Run(new Launcher(root, key, noBrowser, setup));
                return 0;
            }
        }
    }
}
