# Overwatch landing page

A standalone static site. It has no runtime connection to the Cursor extension,
does not read workspace data, and is excluded from the extension package.
The Space Grotesk font is self-hosted; its license is in `assets/OFL.txt`.

From the repository root:

```sh
npm run dev:landing
```

Open http://127.0.0.1:4173. Use `PORT=4174 npm run dev:landing` to choose another
port. Stop the preview with Ctrl+C.

To deploy, upload the contents of `landing/` to any static host. No build step,
environment variables, extension process, or backend is required.
