var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

// Phase 1: single health/hello endpoint. Business endpoints arrive in later phases.
app.MapGet("/", () => "Shree Ganeshay nammh:");

app.Run();
