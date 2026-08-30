import descopeSdk from '@descope/node-sdk';
const descope = descopeSdk({ 
  projectId: "P3IdWUIZar6jULUMA1nLmSBl4Ber", 
  managementKey: "mb3arxemYpJGtNPz7l4EHTExNuPM2TgjnpAAFooUENL" 
});

try {
  const resp = await descope.management.flow.run('hotel-notification-flow', { 
    input: { roomNumber: "101", items: "test", note: "test note" }
  });
  console.log("SUCCESS:", resp);
} catch (e) {
  console.log("ERROR:", e);
}
