using Aspire.Hosting;

var builder = DistributedApplication.CreateBuilder(args);

// Mock Roku ECP server (Node.js on port 8060)
// Simulates Roku device-info, app list, keypresses, icons
var mockRoku = builder.AddNodeApp("mock-roku", "../../mock/roku-mock.mjs", "../../mock")
    .WithHttpEndpoint(port: 8060, env: "PORT")
    .WithExternalHttpEndpoints();

// C++ proxy (pre-built executable on port 8080)
// Forwards ECP requests with CORS, handles SSDP discovery and private listening audio
var proxy = builder.AddExecutable("proxy", "roku-proxy", "../../proxy/build", "--port", "8080")
    .WithHttpEndpoint(port: 8080, env: "PORT")
    .WithExternalHttpEndpoints();

// Angular dev server (port 4200)
var app = builder.AddNpmApp("angular-app", "../../app", "start")
    .WithHttpEndpoint(port: 4200, env: "PORT", isProxied: false)
    .WithExternalHttpEndpoints();

var application = builder.Build();
await application.RunAsync();
