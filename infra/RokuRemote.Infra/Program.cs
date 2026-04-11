using Amazon.CDK;
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

var app = new App();

// Try to load config from config.json (preferred) or fall back to --context params
var configFile = app.Node.TryGetContext("configFile")?.ToString() ?? "../config.json";
var config = LoadConfigFromFile(configFile);

var prefix = TryGetConfigString(config, "prefix")
    ?? app.Node.TryGetContext("prefix")?.ToString()
    ?? "rokuremote";

var environmentName = TryGetConfigString(config, "environment")
    ?? app.Node.TryGetContext("environment")?.ToString()
    ?? "production";

var region = TryGetConfigString(config, "region")
    ?? "ap-southeast-2";

var domainName = TryGetConfigString(config, "domain")
    ?? app.Node.TryGetContext("domain")?.ToString();

var certArnUsEast1 = TryGetConfigString(config, "certificateArnUsEast1")
    ?? app.Node.TryGetContext("certificateArnUsEast1")?.ToString();

var isProd = environmentName == "production";

var stackId = $"RokuRemote-{environmentName}";
new RokuRemoteStack(app, stackId, new StackProps
{
    Env = new Amazon.CDK.Environment
    {
        Account = System.Environment.GetEnvironmentVariable("CDK_DEFAULT_ACCOUNT"),
        Region = region
    },
    Description = $"{prefix} infrastructure for {environmentName} environment",
    Tags = new Dictionary<string, string>
    {
        { "Project", prefix },
        { "Environment", environmentName }
    }
}, new RokuRemoteConfig
{
    Prefix = prefix,
    Environment = environmentName,
    IsProd = isProd,
    DomainName = domainName,
    CertificateArnUsEast1 = certArnUsEast1
});

app.Synth();

static JsonElement? LoadConfigFromFile(string path)
{
    if (!File.Exists(path))
        return null;

    try
    {
        var json = File.ReadAllText(path);
        var doc = JsonDocument.Parse(json);

        if (doc.RootElement.TryGetProperty("rokuremote", out var section))
            return section;

        return null;
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"Warning: Could not read config file '{path}': {ex.Message}");
        return null;
    }
}

static string? TryGetConfigString(JsonElement? config, string property)
{
    if (config == null) return null;
    if (config.Value.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String)
    {
        var str = value.GetString();
        return string.IsNullOrWhiteSpace(str) ? null : str;
    }
    return null;
}

public class RokuRemoteConfig
{
    public string Prefix { get; set; } = "rokuremote";
    public string Environment { get; set; } = "production";
    public bool IsProd { get; set; }
    public string? DomainName { get; set; }
    public string? CertificateArnUsEast1 { get; set; }
}
