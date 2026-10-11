import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  PhoneLayoutContext,
  PhoneLayoutProvider,
  usePhoneChrome,
  usePhoneChromeController,
  usePhoneLayout,
  type PhoneChromeOptions,
} from '../PhoneLayoutContext';

/** Stand-in for AppLayout: owns the controller and puts the attributes on a container. */
function Shell({ isPhone = true, children }: { isPhone?: boolean; children: React.ReactNode }) {
  const { contextValue, attributes } = usePhoneChromeController(isPhone);
  return (
    <PhoneLayoutContext.Provider value={contextValue}>
      <div data-testid="container" {...attributes}>
        {children}
      </div>
    </PhoneLayoutContext.Provider>
  );
}

function Consumer(props: PhoneChromeOptions) {
  usePhoneChrome(props);
  return null;
}

function IsPhone() {
  return <span data-testid="is-phone">{String(usePhoneLayout().isPhone)}</span>;
}

const container = () => screen.getByTestId('container');

describe('PhoneLayoutContext', () => {
  it('sets the attributes while a consumer is mounted and removes them on unmount', () => {
    const { rerender } = render(
      <Shell>
        <Consumer pageHeader tabBar={false} />
      </Shell>,
    );
    expect(container()).toHaveAttribute('data-phone-page-header', '');
    expect(container()).toHaveAttribute('data-phone-tab-bar', 'hidden');

    rerender(<Shell>{null}</Shell>);
    expect(container()).not.toHaveAttribute('data-phone-page-header');
    expect(container()).not.toHaveAttribute('data-phone-tab-bar');
  });

  it('sets nothing for the default options', () => {
    render(
      <Shell>
        <Consumer />
      </Shell>,
    );
    expect(container()).not.toHaveAttribute('data-phone-page-header');
    expect(container()).not.toHaveAttribute('data-phone-tab-bar');
  });

  it('keeps an attribute until the last consumer asking for it unmounts', () => {
    function Harness() {
      const [a, setA] = useState(true);
      const [b, setB] = useState(true);
      return (
        <Shell>
          {a && <Consumer pageHeader />}
          {b && <Consumer pageHeader tabBar={false} />}
          <button onClick={() => setA(false)}>drop a</button>
          <button onClick={() => setB(false)}>drop b</button>
        </Shell>
      );
    }
    render(<Harness />);
    expect(container()).toHaveAttribute('data-phone-page-header');
    expect(container()).toHaveAttribute('data-phone-tab-bar', 'hidden');

    act(() => screen.getByText('drop b').click());
    // b was the only one hiding the tab bar; a still wants the page header.
    expect(container()).toHaveAttribute('data-phone-page-header');
    expect(container()).not.toHaveAttribute('data-phone-tab-bar');

    act(() => screen.getByText('drop a').click());
    expect(container()).not.toHaveAttribute('data-phone-page-header');
  });

  it('does not leave a stale attribute when two routes swap in one commit', () => {
    function Harness() {
      const [route, setRoute] = useState<'a' | 'b' | 'c'>('a');
      return (
        <Shell>
          {route === 'a' && <Consumer key="a" pageHeader />}
          {route === 'b' && <Consumer key="b" pageHeader tabBar={false} />}
          {route === 'c' && <Consumer key="c" />}
          <button onClick={() => setRoute('b')}>to b</button>
          <button onClick={() => setRoute('c')}>to c</button>
        </Shell>
      );
    }
    render(<Harness />);
    act(() => screen.getByText('to b').click());
    expect(container()).toHaveAttribute('data-phone-page-header');
    expect(container()).toHaveAttribute('data-phone-tab-bar', 'hidden');

    act(() => screen.getByText('to c').click());
    expect(container()).not.toHaveAttribute('data-phone-page-header');
    expect(container()).not.toHaveAttribute('data-phone-tab-bar');
  });

  it('follows option changes on a mounted consumer', () => {
    const { rerender } = render(
      <Shell>
        <Consumer tabBar={false} />
      </Shell>,
    );
    expect(container()).toHaveAttribute('data-phone-tab-bar', 'hidden');
    rerender(
      <Shell>
        <Consumer pageHeader />
      </Shell>,
    );
    expect(container()).toHaveAttribute('data-phone-page-header');
    expect(container()).not.toHaveAttribute('data-phone-tab-bar');
  });

  it('exposes isPhone from the shell', () => {
    render(
      <Shell isPhone>
        <IsPhone />
      </Shell>,
    );
    expect(screen.getByTestId('is-phone')).toHaveTextContent('true');
  });

  it('reports desktop and ignores chrome requests outside the shell', () => {
    render(
      <>
        <Consumer pageHeader tabBar={false} />
        <IsPhone />
      </>,
    );
    expect(screen.getByTestId('is-phone')).toHaveTextContent('false');
  });

  it('PhoneLayoutProvider exposes isPhone without a container', () => {
    render(
      <PhoneLayoutProvider isPhone>
        <Consumer pageHeader />
        <IsPhone />
      </PhoneLayoutProvider>,
    );
    expect(screen.getByTestId('is-phone')).toHaveTextContent('true');
  });
});
