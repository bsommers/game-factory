package factoryclient

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestEnvelopeAndErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/kits.list":
			_, _ = w.Write([]byte(`{"ok":true,"data":{"kits":[1]},"error":null,"next":["kits.show {name}"]}`))
		case "/api/styles.show":
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"ok":false,"data":null,"error":{"code":"NOT_FOUND","message":"nope"},"next":[]}`))
		default:
			w.WriteHeader(502)
			_, _ = w.Write([]byte(`<html>`))
		}
	}))
	defer srv.Close()
	c := New(srv.URL)
	env, err := c.KitsList(context.Background(), KitsListInput{})
	if err != nil || !env.OK || len(env.Next) != 1 {
		t.Fatalf("kits.list: %v %+v", err, env)
	}
	var d struct{ Kits []int }
	if err := env.Decode(&d); err != nil || len(d.Kits) != 1 {
		t.Fatalf("decode: %v %+v", err, d)
	}
	_, err = c.StylesShow(context.Background(), StylesShowInput{Id: "x"})
	var ae *Error
	if !errors.As(err, &ae) || ae.Code != ErrNotFound || ae.Status != 404 {
		t.Fatalf("want NOT_FOUND, got %v", err)
	}
	_, err = c.Call(context.Background(), "x.y", nil)
	if !errors.As(err, &ae) || ae.Code != ErrBadResponse {
		t.Fatalf("want BAD_RESPONSE, got %v", err)
	}
}

func TestTimeoutIsTransportError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(300 * time.Millisecond) }))
	defer srv.Close()
	c := New(srv.URL)
	c.HTTP.Timeout = 50 * time.Millisecond
	_, err := c.Capabilities(context.Background())
	var ae *Error
	if !errors.As(err, &ae) || ae.Code != ErrTransport {
		t.Fatalf("want TRANSPORT, got %v", err)
	}
}

// Smoke test against a real `bin/factory serve`; the node test sets FACTORY_URL.
func TestSmokeLiveServer(t *testing.T) {
	base := os.Getenv("FACTORY_URL")
	if base == "" {
		t.Skip("FACTORY_URL not set (start `bin/factory serve --port 0` and export it)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	c := New(base)
	caps, err := c.Capabilities(ctx)
	if err != nil || !caps.OK {
		t.Fatalf("capabilities: %v", err)
	}
	env, err := c.KitsList(ctx, KitsListInput{})
	if err != nil || !env.OK {
		t.Fatalf("kits.list: %v", err)
	}
	_, err = c.Call(ctx, "nope.nothing", nil)
	var ae *Error
	if !errors.As(err, &ae) || ae.Code != ErrUnknownCapability || ae.Status != 404 {
		t.Fatalf("want UNKNOWN_CAPABILITY, got %v", err)
	}
	_, err = c.StylesShow(ctx, StylesShowInput{Id: ""})
	_ = err // empty id is rejected by the server; either BAD_INPUT or NOT_FOUND is a typed *Error
	dir := t.TempDir()
	if _, err := c.SwarmTrack(ctx, SwarmTrackInput{Project: &dir, Agent: "go-smoke", State: "start", Message: strPtr("hello")}); err != nil {
		t.Fatalf("swarm.track: %v", err)
	}
	evs, errs := c.Events(ctx, dir, "")
	select {
	case e := <-evs:
		if e.Name != "progress" {
			t.Fatalf("event name %q", e.Name)
		}
	case err := <-errs:
		t.Fatalf("events: %v", err)
	case <-ctx.Done():
		t.Fatal("no progress event")
	}
}

func strPtr(s string) *string { return &s }
