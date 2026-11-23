// A port nothing is listening on, chosen by the operating system. Tests that start a server on a port of their own
// use this instead of a random number: a random number inside 18000-20000 lands, now and then, on a port another test
// file holds by name (the suite runs its files side by side), and that test fails with EADDRINUSE for no reason of
// its own. The system's range for these (32768 and up on Linux) is clear of every fixed port the suite uses.
import net from 'node:net';

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}
