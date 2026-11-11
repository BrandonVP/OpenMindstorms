# Third-party material

OpenMindstorms itself is MIT licensed (see [LICENSE](LICENSE)). These parts of the
repository come from elsewhere and keep their own licences:

| Path | What | Licence |
| --- | --- | --- |
| `web/rcx/vendor/blockly/` | Blockly 11.2.2 by Google, the block editor used by all three Workbenches | Apache 2.0 ([LICENSE](web/rcx/vendor/blockly/LICENSE)) |
| `web/rcx/vendor/webnqc/` | WebNQC by maehw: the NQC compiler built to WebAssembly, used by OpenRCX in the browser | MPL 2.0 ([LICENSE.md](web/rcx/vendor/webnqc/LICENSE.md)) |
| `tools/nqc/` | NQC 3.1 r6 by Dave Baum and John Hansen, Win32 build | MPL 2.0 ([LICENSE](tools/nqc/LICENSE)) |
| `firmware/*.lgo` | Official LEGO RCX firmware images (firm0328, firm0309), copyright The LEGO Group, redistributed for the preservation of the RCX as the BrickBot archive does | LEGO's |
| `docs/*.pdf` | LEGO reference documents (RCX 2.0 firmware byte codes, USB tower interface, NQC programmer's guide) | LEGO's / the authors' |
| `truenas/nxc-service` | runs the NBC/NXC compiler from the Debian `nbc` package inside its container (not in this repository) | MPL 1.1 |

LEGO and Mindstorms are trademarks of the LEGO Group, which does not sponsor,
authorise or endorse this project.
