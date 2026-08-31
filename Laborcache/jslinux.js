/* 
   Linux launcher

   Copyright (c) 2011 Fabrice Bellard

   Redistribution or commercial use is prohibited without the author's
   permission.
*/
"use strict";

var term, pc, boot_start_time;

/* utility: asynchronous binary loader (was missing after the
   cpux86-ta.js update to the 2013 async API) */
function load_binary(url, cb)
{
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = function () {
        if ((xhr.status === 200 || xhr.status === 0) && xhr.response) {
            var buf = new Uint8Array(xhr.response);
            cb(buf, buf.length);
        } else {
            cb(null, -1);
        }
    };
    xhr.onerror = function () { cb(null, -1); };
    xhr.send();
}

function term_start()
{
    term = new Term(80, 30, term_handler);

    term.open();
}

/* send chars to the serial port */
function term_handler(str)
{
    pc.serial.send_chars(str);
}

function clipboard_set(val)
{
    var el;
    el = document.getElementById("text_clipboard");
    el.value = val;
}

function clipboard_get()
{
    var el;
    el = document.getElementById("text_clipboard");
    return el.value;
}

function clear_clipboard()
{
    var el;
    el = document.getElementById("text_clipboard");
    el.value = "";
}

/* just used to display the boot time in the VM */
function get_boot_time()
{
    return (+new Date()) - boot_start_time;
}

function start()
{
    var start_addr, params, cmdline_addr;

    params = new Object();

    /* serial output chars */
    params.serial_write = term.write.bind(term);

    /* memory size (in bytes) */
    params.mem_size = 16 * 1024 * 1024;

    /* clipboard I/O */
    params.clipboard_get = clipboard_get;
    params.clipboard_set = clipboard_set;

    params.get_boot_time = get_boot_time;

    pc = new PCEmulator(params);

    start_addr = 0x10000;
    cmdline_addr = 0xf800;

    /* the 2013 emulator API loads binaries asynchronously,
       so chain the three loads before booting */
    pc.load_binary("vmlinux26.bin", 0x00100000, function (kernel_size) {
        if (kernel_size < 0) { term.writeln("Error loading vmlinux26.bin"); return; }
        pc.load_binary("root.bin", 0x00400000, function (initrd_size) {
            if (initrd_size < 0) { term.writeln("Error loading root.bin"); return; }
            pc.load_binary("linuxstart.bin", start_addr, function (start_size) {
                if (start_size < 0) { term.writeln("Error loading linuxstart.bin"); return; }

                /* set the Linux kernel command line */
                /* Note: we don't use initramfs because it is not possible to
                   disable gzip decompression in this case, which would be too
                   slow. */
                pc.cpu.write_string(cmdline_addr, "console=ttyS0 root=/dev/ram0 rw init=/sbin/init notsc=1");

                pc.cpu.eip = start_addr;
                pc.cpu.regs[0] = params.mem_size; /* eax */
                pc.cpu.regs[3] = initrd_size; /* ebx */
                pc.cpu.regs[1] = cmdline_addr; /* ecx */

                boot_start_time = (+new Date());

                pc.start();
            });
        });
    });
}

term_start();
