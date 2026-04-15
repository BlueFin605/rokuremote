using Aspire.Hosting;

var builder = DistributedApplication.CreateBuilder(args);

static string ResolveProxyExecutablePath()
{
    var exeName = OperatingSystem.IsWindows() ? "roku-proxy.exe" : "roku-proxy";

    // Primary path when running from source/project directory
    var projectRelative = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "../../proxy/build", exeName));
    if (File.Exists(projectRelative))
    {
        return projectRelative;
    }

    // Fallback path when running from AppHost bin output directory
    var binRelative = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../proxy/build", exeName));
    return binRelative;
}

// Mock Roku ECP server (Node.js on port 8060)
// Simulates Roku device-info, app list, keypresses, icons
var mockRoku = builder.AddNodeApp("mock-roku", "../../mock", "roku-mock.mjs")
    .WithHttpEndpoint(port: 8060, env: "PORT")
    .WithExternalHttpEndpoints();

// C++ proxy (pre-built executable on port 8080)
// Forwards ECP requests with CORS, handles SSDP discovery and private listening audio
var proxyExecutablePath = ResolveProxyExecutablePath();
if (!File.Exists(proxyExecutablePath))
{
    throw new FileNotFoundException($"Proxy executable not found at '{proxyExecutablePath}'. Run setup-aspire.ps1 to build/copy it.");
}

var proxyWorkingDirectory = Path.GetDirectoryName(proxyExecutablePath)
    ?? throw new InvalidOperationException("Failed to resolve proxy working directory.");

var proxy = builder.AddExecutable("proxy", proxyExecutablePath, proxyWorkingDirectory)
    .WithArgs("--port", "8080")
    .WithHttpEndpoint(port: 8080, env: "PORT", isProxied: false)
    .WithExternalHttpEndpoints();

// Angular dev server (port 4200)
var app = builder.AddJavaScriptApp("angular-app", "../../app")
    .WithRunScript("start")
    .WithHttpEndpoint(port: 4200, env: "PORT", isProxied: false)
    .WithExternalHttpEndpoints();

var application = builder.Build();
await application.RunAsync();
