#!/bin/bash
# Run this to generate all the initial makefiles, etc.

srcdir=`dirname $0`
test -z "$srcdir" && srcdir=.

PKG_NAME="polari"

(test -f $srcdir/configure.ac \
  && test -d $srcdir/src) || {
    echo -n "**Error**: Directory "\`$srcdir\'" does not look like the"
    echo " top-level polari directory"
    exit 1
}

which gnome-autogen.sh || {
    echo "You need to install gnome-common from GNOME Git (or from"
    echo "your OS vendor's package manager)."
    exit 1
}
. gnome-autogen.sh
